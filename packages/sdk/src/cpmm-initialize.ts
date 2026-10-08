/**
 * DeepSwap permissionless pool creation: the `initialize` and `initialize_v1` instructions of
 * programs/deep-amm (instructions/initialize.rs), plus the amounts they derive. Anyone can
 * create a pool for any two mints the program supports (see cpmm-token2022.ts
 * `cpmmMintSupported`).
 */
import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { deepSwapRewardRateFromBps, validateDeepSwapPoolReward } from "@deepliquidity/curve-math";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { discriminator } from "./constants.js";
import { DEEP_REWARDS_PROGRAM_ID, distributorPda, holderVaultPda } from "./rewards.js";
import {
  cpmmAuthority,
  cpmmLpMint,
  cpmmObservation,
  cpmmPoolPda,
  cpmmVault,
  DEEP_AMM_PROGRAM_ID,
  sortMints,
} from "./raydium-cpmm.js";

export * from "./cpmm-token2022.js";

/** LP units the program keeps out of the creator's hands at pool creation (`lock_lp_amount`). */
export const CPMM_LOCKED_LP = 100n;
/** Compute unit limit that covers `initialize` (two vaults, LP mint, ATA, observation). */
export const CPMM_INITIALIZE_COMPUTE_UNITS = 400_000;

const U64_MAX = (1n << 64n) - 1n;

/** Floor of the square root, as the program's `U128::integer_sqrt`. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("negative");
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * LP minted at pool creation from the amounts that ARRIVE in the vaults (after any Token-2022
 * transfer fee): `liquidity = floor(sqrt(vault0 × vault1))`, of which the creator receives
 * `liquidity − 100`. Throws where the program rejects (empty side, or liquidity under 100).
 */
export function cpmmInitialLiquidity(
  vault0: bigint,
  vault1: bigint,
): { liquidity: bigint; creatorLp: bigint } {
  if (vault0 <= 0n || vault1 <= 0n) throw new RangeError("both sides need a non-zero amount");
  const liquidity = isqrt(vault0 * vault1);
  if (liquidity < CPMM_LOCKED_LP)
    throw new RangeError("amounts too small: the first 100 LP units are locked");
  return { liquidity, creatorLp: liquidity - CPMM_LOCKED_LP };
}

export interface CpmmInitializeArgs {
  /** Defaults to deep-amm. */
  programId?: PublicKey;
  /** Signs, pays rent and the create-pool fee, and receives the LP tokens. */
  creator: PublicKey;
  /** The AmmConfig the pool belongs to (fee rates, create-pool fee). */
  ammConfig: PublicKey;
  /** The pair in any order; the builder sorts it the way the program requires. */
  mintA: PublicKey;
  mintB: PublicKey;
  /** Owner program of each mint (SPL Token or Token-2022), read from chain. */
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
  /** Amount of each token the creator sends, base units. Together they set the price. */
  amountA: bigint;
  amountB: bigint;
  /** Unix seconds from which swaps are allowed; 0 (default) = right away. */
  openTime?: bigint;
  /**
   * The WSOL account the program build names as create-pool fee receiver
   * (DEEP_AMM_CREATE_POOL_FEE_RECEIVER). It is fixed at build time, so it is always passed in.
   */
  createPoolFeeReceiver: PublicKey;
  /** Default: the creator's associated token accounts under each mint's own program. */
  creatorTokenA?: PublicKey;
  creatorTokenB?: PublicKey;
  /**
   * `deepAmmSupportMintPda(mint)` for each Token-2022 mint that is on the allow list. Sent as
   * remaining accounts; the program ignores entries that are not an initialized allow entry.
   */
  supportMints?: PublicKey[];
}

export interface CpmmInitializeAccounts {
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  /** True when `mintA` is token 0. */
  aIsToken0: boolean;
  poolState: PublicKey;
  lpMint: PublicKey;
  creatorLpToken: PublicKey;
  token0Vault: PublicKey;
  token1Vault: PublicKey;
  observation: PublicKey;
}

/** Addresses `initialize` creates for a pair under an AmmConfig. */
export function cpmmInitializeAccounts(a: {
  programId?: PublicKey;
  creator: PublicKey;
  ammConfig: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
}): CpmmInitializeAccounts {
  const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
  if (a.mintA.equals(a.mintB)) throw new Error("a pool needs two different mints");
  const [token0Mint, token1Mint] = sortMints(a.mintA, a.mintB);
  const poolState = cpmmPoolPda(programId, a.ammConfig, token0Mint, token1Mint);
  const lpMint = cpmmLpMint(programId, poolState);
  return {
    token0Mint,
    token1Mint,
    aIsToken0: token0Mint.equals(a.mintA),
    poolState,
    lpMint,
    // LP mints are created under the legacy token program.
    creatorLpToken: getAssociatedTokenAddressSync(lpMint, a.creator, true),
    token0Vault: cpmmVault(programId, poolState, token0Mint),
    token1Vault: cpmmVault(programId, poolState, token1Mint),
    observation: cpmmObservation(programId, poolState),
  };
}

/**
 * `initialize(init_amount_0, init_amount_1, open_time)`. Under a legacy AmmConfig it opens a
 * legacy pool; under a DEEP V1 config, a V1 STANDARD pool (no reward) whose quote token is
 * `cpmmDefaultQuoteMint`. To choose reward terms or the quote token use `initializeV1Ix`.
 */
export function cpmmInitializeIx(a: CpmmInitializeArgs): TransactionInstruction {
  return initializeIx(a);
}

// ───────────── DEEP V1: a pool with its creator's reward terms ─────────────

/**
 * The quote token of a V1 pool opened without naming one (deep-amm `default_quote_side`): the
 * token every fee is taken in. WSOL when the pair has it, otherwise token 1 (the mint that
 * sorts last).
 */
export function cpmmDefaultQuoteMint(mintA: PublicKey, mintB: PublicKey): PublicKey {
  if (mintA.equals(NATIVE_MINT) || mintB.equals(NATIVE_MINT)) return NATIVE_MINT;
  return sortMints(mintA, mintB)[1];
}

/** The reward terms the creator of a V1 pool chooses. Immutable once the pool exists. */
export interface CpmmPoolRewardTerms {
  /** 0 Standard (default), 1 Creator, 2 Holder (`REWARD_MODEL`). */
  rewardModel?: number;
  /**
   * The pool's reward rate in BPS (the same unit as a launch's `rewardBps`), charged on both
   * sides on top of the AmmConfig's rates: 0 for Standard (default), 1..=500 (5%) otherwise.
   * Sent to the program as `rewardBps * 100` per 1e6.
   */
  rewardBps?: number;
  /**
   * The pool's quote token, the one every fee is taken in: one of the two mints. Default
   * `cpmmDefaultQuoteMint`. A pair with WSOL must be quoted in WSOL.
   */
  quoteMint?: PublicKey;
  /**
   * Optional, for a clearer error before sending: the decoded AmmConfig's `maxRewardRate`
   * (per 1e6), the admin's current maximum; the program rejects a rate above it
   * (RewardRateAboveMax, 6025).
   */
  maxRewardRate?: bigint;
  /** Defaults to deep-rewards (the program a Holder pool's vault is derived under). */
  rewardsProgramId?: PublicKey;
}

export interface CpmmV1PoolTerms {
  quoteMint: PublicKey;
  /** The non-quote mint. */
  baseMint: PublicKey;
  /** deep-amm `CreatorFeeOn` tag of the quote side: 1 = token0, 2 = token1. */
  quoteSide: 1 | 2;
  rewardModel: number;
  /** Per 1e6: `rewardBps * 100`. */
  rewardRate: bigint;
  /**
   * Where the pool's reward fees go, recorded as its `poolCreator`. The program derives it,
   * it is never passed: the pool's creator for Standard (never accrues) and Creator, the
   * deep-rewards holder vault of the non-quote token for Holder.
   */
  rewardRecipient: PublicKey;
  /**
   * Holder pools only: the deep-rewards distributor of (`baseMint`, `quoteMint`). It MUST
   * exist already (DEEP's `init_distributor`), or `initialize_v1` fails with
   * HolderRewardsNeedDistributor (6029): the pool's reward fees have no other way out.
   * `initializeV1Ix` passes it as the last remaining account.
   */
  distributor?: PublicKey;
}

/**
 * The Holder recipient of a pool opened with `initialize_v1`: the deep-rewards holder vault
 * of the pool's NON-quote token, `holderVaultPda(baseMint)`.
 */
export function cpmmHolderRewardRecipient(
  baseMint: PublicKey,
  rewardsProgramId = DEEP_REWARDS_PROGRAM_ID,
): PublicKey {
  return holderVaultPda(baseMint, rewardsProgramId);
}

/**
 * Validates a V1 pool's reward terms the way `initialize_v1` does and resolves what it
 * derives. Throws on: an unknown model; a rate that does not fit it (Standard 0, Creator /
 * Holder 1..=500 bps) or is above `maxRewardRate`; a quote that is not one of the mints or is
 * not WSOL on a WSOL pair; a Holder pool not quoted in WSOL (HolderRewardsNeedSolQuote).
 */
export function cpmmV1PoolTerms(
  a: { creator: PublicKey; mintA: PublicKey; mintB: PublicKey } & CpmmPoolRewardTerms,
): CpmmV1PoolTerms {
  if (a.mintA.equals(a.mintB)) throw new Error("a pool needs two different mints");
  const [mint0, mint1] = sortMints(a.mintA, a.mintB);
  const rewardModel = a.rewardModel ?? 0;
  const rewardBps = a.rewardBps ?? 0;
  if (!Number.isInteger(rewardBps) || rewardBps < 0)
    throw new RangeError("rewardBps must be a whole number of bps");
  const rewardRate = deepSwapRewardRateFromBps(BigInt(rewardBps));
  validateDeepSwapPoolReward(rewardModel, rewardRate, a.maxRewardRate);
  const quoteMint = a.quoteMint ?? cpmmDefaultQuoteMint(mint0, mint1);
  if (!quoteMint.equals(mint0) && !quoteMint.equals(mint1))
    throw new Error("quoteMint must be one of the pool's two mints");
  const baseMint = quoteMint.equals(mint0) ? mint1 : mint0;
  if (baseMint.equals(NATIVE_MINT))
    throw new Error("a pair with WSOL takes its fees in WSOL: quoteMint must be the WSOL mint");
  if (rewardModel === 2 && !quoteMint.equals(NATIVE_MINT))
    throw new Error("a Holder Rewards pool opened with initialize_v1 must be quoted in SOL");
  return {
    quoteMint,
    baseMint,
    quoteSide: quoteMint.equals(mint0) ? 1 : 2,
    rewardModel,
    rewardRate,
    rewardRecipient:
      rewardModel === 2 ? cpmmHolderRewardRecipient(baseMint, a.rewardsProgramId) : a.creator,
    ...(rewardModel === 2
      ? { distributor: distributorPda(baseMint, quoteMint, a.rewardsProgramId) }
      : {}),
  };
}

export interface InitializeV1Args extends CpmmInitializeArgs, CpmmPoolRewardTerms {}

/**
 * deep-amm `initialize_v1(init_amount_0, init_amount_1, open_time, creator_fee_on,
 * reward_model, reward_rate)`: permissionless, same accounts as `initialize`. Opens a DEEP V1
 * pool under a V1 AmmConfig (a legacy config is rejected, FeeModelMismatch) with the reward
 * terms its creator chooses, immutable afterwards: `rewardModel` and `rewardBps` (see
 * `CpmmPoolRewardTerms`, `cpmmV1PoolTerms`), and the quote token. The reward recipient is
 * derived by the program: the creator for a Creator pool, `cpmmHolderRewardRecipient` (the
 * holder vault of the non-quote token) for a Holder pool, which must be quoted in SOL and
 * whose (token, SOL) deep-rewards distributor must exist already
 * (HolderRewardsNeedDistributor, 6029; check `cpmmV1PoolTerms(a).distributor` on chain before
 * offering the Holder model for a token).
 */
export function initializeV1Ix(a: InitializeV1Args): TransactionInstruction {
  return initializeIx(a, cpmmV1PoolTerms(a));
}

function initializeIx(a: CpmmInitializeArgs, v1?: CpmmV1PoolTerms): TransactionInstruction {
  const programId = a.programId ?? DEEP_AMM_PROGRAM_ID;
  const openTime = a.openTime ?? 0n;
  for (const [k, v] of [
    ["amountA", a.amountA],
    ["amountB", a.amountB],
    ["openTime", openTime],
  ] as const)
    if (v < 0n || v > U64_MAX) throw new RangeError(`${k} out of u64 range`);
  if (a.amountA === 0n || a.amountB === 0n)
    throw new RangeError("both amounts must be greater than zero");
  const acc = cpmmInitializeAccounts(a);
  const [amount0, amount1] = acc.aIsToken0 ? [a.amountA, a.amountB] : [a.amountB, a.amountA];
  const [program0, program1] = acc.aIsToken0
    ? [a.tokenProgramA, a.tokenProgramB]
    : [a.tokenProgramB, a.tokenProgramA];
  const ata = (mint: PublicKey, program: PublicKey) =>
    getAssociatedTokenAddressSync(mint, a.creator, true, program);
  const creatorA = a.creatorTokenA ?? ata(a.mintA, a.tokenProgramA);
  const creatorB = a.creatorTokenB ?? ata(a.mintB, a.tokenProgramB);
  const [creator0, creator1] = acc.aIsToken0 ? [creatorA, creatorB] : [creatorB, creatorA];

  const data = Buffer.alloc(v1 ? 8 + 24 + 1 + 1 + 8 : 8 + 24);
  data.set(discriminator("global", v1 ? "initialize_v1" : "initialize"), 0);
  data.writeBigUInt64LE(amount0, 8);
  data.writeBigUInt64LE(amount1, 16);
  data.writeBigUInt64LE(openTime, 24);
  if (v1) {
    data.writeUInt8(v1.quoteSide, 32);
    data.writeUInt8(v1.rewardModel, 33);
    data.writeBigUInt64LE(v1.rewardRate, 34);
  }

  const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
  const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: a.creator, isSigner: true, isWritable: true },
      ro(a.ammConfig),
      ro(cpmmAuthority(programId)),
      rw(acc.poolState),
      ro(acc.token0Mint),
      ro(acc.token1Mint),
      rw(acc.lpMint),
      rw(creator0),
      rw(creator1),
      rw(acc.creatorLpToken),
      rw(acc.token0Vault),
      rw(acc.token1Vault),
      rw(a.createPoolFeeReceiver),
      rw(acc.observation),
      ro(TOKEN_PROGRAM_ID),
      ro(program0),
      ro(program1),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(SystemProgram.programId),
      ro(SYSVAR_RENT_PUBKEY),
      ...(a.supportMints ?? []).map(ro),
      ...(v1?.distributor ? [ro(v1.distributor)] : []),
    ],
    data,
  });
}
