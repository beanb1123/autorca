import { PublicKey } from "@solana/web3.js";
import {
    WhirlpoolContext, AccountFetcher, ORCA_WHIRLPOOL_PROGRAM_ID, buildWhirlpoolClient,
    PDAUtil, ORCA_WHIRLPOOLS_CONFIG, WhirlpoolData, PoolUtil, swapQuoteByInputToken
} from "@orca-so/whirlpools-sdk";
import { Provider } from "@project-serum/anchor";
import { DecimalUtil, Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";

// THIS SCRIPT REQUIRES ENVIRON VARS!!!
// bash$ export ANCHOR_PROVIDER_URL=https://ssc-dao.genesysgo.net
// bash$ export ANCHOR_WALLET=~/.config/solana/id.json
// bash$ ts-node this_script.ts

const provider = Provider.env();
console.log("connection endpoint", provider.connection.rpcEndpoint);
console.log("wallet", provider.wallet.publicKey.toBase58());

async function main() {
    const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
    const fetcher = new AccountFetcher(ctx.connection);
    const client = buildWhirlpoolClient(ctx, fetcher);

    // get pool
    const SOL = {mint: new PublicKey("So11111111111111111111111111111111111111112"), decimals: 9};
    const USDC = {mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), decimals: 6};
    const tick_spacing = 64;
    const whirlpool_key = PDAUtil.getWhirlpool(
        ORCA_WHIRLPOOL_PROGRAM_ID, ORCA_WHIRLPOOLS_CONFIG,
        SOL.mint, USDC.mint, tick_spacing).publicKey;
    console.log("whirlpool_key", whirlpool_key.toBase58());

    // get swap quote
    const amount_in = new Decimal("0.001" /* SOL */);

    const aToB = true; // SOL to USDC direction
    const whirlpool_data = (await fetcher.getPool(whirlpool_key, true)) as WhirlpoolData;
    const tick_array_address = PoolUtil.getTickArrayPublicKeysForSwap(
        whirlpool_data.tickCurrentIndex,
        whirlpool_data.tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpool_key
    );
    const tick_array_sequence_data = await fetcher.listTickArrays(tick_array_address, true);

    const quote = swapQuoteByInputToken({
        whirlpoolAddress: whirlpool_key,
        swapTokenMint: whirlpool_data.tokenMintA, // input is SOL
        whirlpoolData: whirlpool_data,
        tokenAmount: DecimalUtil.toU64(amount_in, SOL.decimals), // toU64 (SOL to lamports)
        amountSpecifiedIsInput: true, // tokenAmount means input amount of SOL
        slippageTolerance: Percentage.fromFraction(1, 100),
        tickArrayAddresses: tick_array_address,
        tickArrays: tick_array_sequence_data,
    });

    // print quote
    console.log("aToB", quote.aToB);
    console.log("estimatedAmountIn", DecimalUtil.fromU64(quote.estimatedAmountIn, SOL.decimals).toString(), "SOL");
    console.log("estimatedAmountOut", DecimalUtil.fromU64(quote.estimatedAmountOut, USDC.decimals).toString(), "USDC");

    // execute transaction
    const pool = await client.getPool(whirlpool_key);
    const tx = await pool.swap(quote);
    const signature = await tx.buildAndExecute();
    console.log("signature", signature);
    ctx.connection.confirmTransaction(signature, "confirmed");
}

main();
