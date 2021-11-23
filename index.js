import { Connection, Keypair } from "@solana/web3.js";
import { getOrca, OrcaPoolConfig } from "@orca-so/sdk";
import Decimal from "decimal.js";
import bs58 from "bs58";
import _ from "lodash";
import fetch from "node-fetch";
import {quantileRank} from "simple-statistics";
import fs from "fs";

// The get data function from CMC
const getData = async(id) => {
  const res = await fetch("https://api.coinmarketcap.com/data-api/v3/cryptocurrency/historical?id=" + String(id) + "&convertId=2781&timeStart=1199175151&timeEnd=" + String(Date.now()) + "&interval=hourly", {cache: "no-cache"})
  var data = await res.json()
  data = data["data"]["quotes"]

  for (let i = 0; i < data.length; i++) {
    data[i]["quote"]["growth"] = (data[i]["quote"]["close"]/data[i]["quote"]["open"]) - 1
  }

  return data
}

// The get price and recieveAmount function for swap function
const getPrice = async (recieveTokenB = false, giveTokenIsSOL = false, pool, connection) => {

  try {
    /*** Swap ***/
    var giveToken;
    var recieveToken;
    if(recieveTokenB) {
      giveToken = await pool.getTokenA();
      recieveToken = await pool.getTokenB();
    } else {
      giveToken = await pool.getTokenB();
      recieveToken = await pool.getTokenA();
    }

    var giveAmount;
    if(giveTokenIsSOL) {
      const solLamportAmount = await connection.getBalance(owner.publicKey)
      const solBalance = await solLamportAmount * 0.000000001
      const maxSolTradeAmount = await solBalance - 0.10
      giveAmount = await new Decimal(maxSolTradeAmount);
    } else {
      const tokenInfo = await connection.getParsedTokenAccountsByOwner(owner.publicKey, {mint: giveToken.mint}, {encoding: "jsonParsed"})
      const tokenAmount = await tokenInfo.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      giveAmount = await new Decimal(tokenAmount);
    }
    const slippage = new Decimal(0.0025)
    const quote = await pool.getQuote(giveToken, giveAmount, slippage);
    const recieveAmount = await quote.getMinOutputAmount();
    var quotePrice; 
    if(recieveTokenB) {
      quotePrice = await recieveAmount.toNumber()/giveAmount.toNumber();
    } else {
      quotePrice = await giveAmount.toNumber()/recieveAmount.toNumber();
    }

    return {recieveAmount, quotePrice};
  } catch (err) {
    console.warn(err);
  }
};

// The general swap function
const swap = async (recieveAmount, recieveTokenB = false, giveTokenIsSOL = false, pool, connection) => {

  try {
    /*** Swap ***/
    var giveToken;
    var recieveToken;
    if(recieveTokenB) {
      giveToken = pool.getTokenA();
      recieveToken = pool.getTokenB();
    } else {
      giveToken = pool.getTokenB();
      recieveToken = pool.getTokenA();
    }

    var giveAmount;
    if(giveTokenIsSOL) {
      const solLamportAmount = await connection.getBalance(owner.publicKey)
      const solBalance = await solLamportAmount * 0.000000001
      const maxSolTradeAmount = await solBalance - 0.10
      giveAmount = new Decimal(maxSolTradeAmount);
    } else {
      const tokenInfo = await connection.getParsedTokenAccountsByOwner(owner.publicKey, {mint: giveToken.mint}, {encoding: "jsonParsed"})
      const tokenAmount = await tokenInfo.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      giveAmount = new Decimal(tokenAmount);
    }
    const price = recieveTokenB ? recieveAmount.toNumber()/giveAmount : giveAmount/recieveAmount.toNumber();

    console.log(`Swap ${giveAmount.toString()} ${giveToken.name} for at least ${recieveAmount.toNumber()} ${recieveToken.name} at the price of ${price} USDC`);
    const swapPayload = await pool.swap(owner, giveToken, giveAmount, recieveAmount);
    const swapTxId = await swapPayload.execute();
    console.log("Swapped:", swapTxId, "\n");
    return price;
  } catch (err) {
    console.warn(err);
  }
};

const trade = async (recieveAmount, action, orca, connection) => {

  try {

  if (action == "buy") {
    const pool = await orca.getPool(OrcaPoolConfig.LIQ_USDC);
    const giveToken = pool.getTokenA();
    const recieveToken = pool.getTokenB();
    const tokenInfo = await connection.getParsedTokenAccountsByOwner(owner.publicKey, {mint: giveToken.mint}, {encoding: "jsonParsed"})
    const tokenAmount = await tokenInfo.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    if(tokenAmount < 1) {
      // Main swap action to convert USDC to ORCA
      const price = await swap(recieveAmount, false, false, pool, connection)
      return price;
    } else {
      console.log(giveToken.name + " is already owned.")
    }
  } else if (action == "sell") {
    const pool = await orca.getPool(OrcaPoolConfig.LIQ_USDC);
    const giveToken = pool.getTokenA();
    const recieveToken = pool.getTokenB();
    const tokenInfo = await connection.getParsedTokenAccountsByOwner(owner.publicKey, {mint: recieveToken.mint}, {encoding: "jsonParsed"})
    const tokenAmount = await tokenInfo.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    if(tokenAmount < 1) {
      // Main swap action to convert ORCA to USDC
      const price = await swap(recieveAmount, true, false, pool, connection)
      return price;
    } else {
      console.log(recieveToken.name + " is already owned.")
    }
  } else {
     console.log("The action " + action + " does not exist.")
  }

  // Log that we are done
  console.log("Done")
  } catch (err) {
    console.log(err)
  }

}

const writeActionsFile = async (data) => {
  await fs.writeFileSync('./actions.json', JSON.stringify(data, null, 2) , 'utf-8');
  return;
}

const main = async (orca, connection) => {

  const pool = await orca.getPool(OrcaPoolConfig.LIQ_USDC);
  const aToken = pool.getTokenA();
  const bToken = pool.getTokenB();
  const atokenInfo = await connection.getParsedTokenAccountsByOwner(owner.publicKey, {mint: aToken.mint}, {encoding: "jsonParsed"});
  const atokenAmount = await atokenInfo.value[0].account.data.parsed.info.tokenAmount.uiAmount;
  const btokenInfo = await connection.getParsedTokenAccountsByOwner(owner.publicKey, {mint: bToken.mint}, {encoding: "jsonParsed"});
  const btokenAmount = await btokenInfo.value[0].account.data.parsed.info.tokenAmount.uiAmount;
  var data = await getData(11013);
  var growths = _.map(data, "quote.growth");
  const currentOpen = data[data.length - 1]["quote"]["open"];
  const fee = 0.0055;

  if(Number(atokenAmount) > 1) {
    const {recieveAmount, quotePrice} = await getPrice(true, false, pool, connection);
    const currentGrowth = await (quotePrice/currentOpen) - 1;
    const currentQuantile = await quantileRank(growths, currentGrowth);
    console.log("The current quantile is " + String(currentQuantile));
    if(currentQuantile > 0.65) {
      var actions = [];
      var lastBuyPrice;
      if(fs.existsSync('./actions.json')) {
        let actionsrawdata = await fs.readFileSync('./actions.json');
        actions = await JSON.parse(actionsrawdata);
        lastBuyPrice = await actions[actions.length - 1]["price"]
      }
      if(quotePrice > (lastBuyPrice * (1 + fee))) {
        const price = await trade(recieveAmount, "sell", orca, connection);
        await actions.push({"date": new Date(), "action": "sell", "return": ((price/lastBuyPrice) - 1) - fee, "price": price, "quaintile": currentQuantile});
        await writeActionsFile(actions);
      } else {
        console.log("Buy price with fees of " + String((lastBuyPrice * (1 + fee))) + " is not greater than current price of " + String(price))
      }
    }
  } else if (Number(btokenAmount) > 1) {
    const {recieveAmount, quotePrice} = await getPrice(false, false, pool, connection);
    const currentGrowth = await (quotePrice/currentOpen) - 1;
    const currentQuantile = await quantileRank(growths, currentGrowth);
    console.log("The current quantile is " + String(currentQuantile));
    if(currentQuantile < 0.35) {
      var actions = [];
      var lastBuyPrice;
      if(fs.existsSync('./actions.json')) {
        let actionsrawdata = await fs.readFileSync('./actions.json');
        actions = await JSON.parse(actionsrawdata);
        lastBuyPrice = await actions[actions.length - 1]["price"]
      }
      const price = await trade(recieveAmount, "buy", orca, connection);
      await actions.push({"date": new Date(), "action": "buy", "return": null, "price": price, "quaintile": currentQuantile});
      await writeActionsFile(actions);
    }
  }

}

const sleep = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

const secretKey = process.env.SECRETKEY
const decoded = bs58.decode(secretKey);
const owner = Keypair.fromSecretKey(decoded);
const connection = new Connection("https://api.mainnet-beta.solana.com", "singleGossip");
const orca = getOrca(connection);

while(true) {

  await main(orca, connection)

  if(fs.existsSync('./actions.json')) {
    let actionsrawdata = await fs.readFileSync('./actions.json');
    var actions = await JSON.parse(actionsrawdata);
    console.table(actions);
  }

  await sleep(1*60*1000)

}