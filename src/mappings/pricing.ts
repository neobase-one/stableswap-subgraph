/* eslint-disable prefer-const */
import { Pair, Token, Bundle, PairMap } from '../types/schema'
import { BigDecimal, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, ONE_BD, UNTRACKED_PAIRS, pairMapKey } from './helpers'

// for canto, ETH ~ CANTO, USDC ~ NOTE
export const NOTE_ADDRESS = "0x4e71a2e537b7f9d9413d3991d37958c0b5e1e503"
export const USDC_ADDRESS = "0x80b5a32e4f032b2a058b4f29ec95eefeeb87adcd"
export const USDT_ADDRESS = "0xd567b3d7b8fe3c79a1ad8da978812cfc4fa05e75"
export const ATOM_ADDRESS = "0xeceeefcee421d8062ef8d6b4d814efe4dc898265"
export const ETH_ADDRESS =  "0x5fd55a1b9fc24967c4db09c513c3ba0dfa7ff687"
export const WCANTO_ADDRESS = '0x826551890dc65655a0aceca109ab11abdbd7a07b'
const NOTE_WCANTO_PAIR = "0x1d20635535307208919f0b67c3b2065965a85aa9"

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let notePair = Pair.load(NOTE_WCANTO_PAIR) // note is token0

  if (notePair !== null) {
    return notePair.token0Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  NOTE_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  ATOM_ADDRESS,
  ETH_ADDRESS,
  WCANTO_ADDRESS,
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('1')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('1')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token, stable: boolean): BigDecimal {
  if (token.id == WCANTO_ADDRESS) {
    return ONE_BD
  }

  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairMap = PairMap.load(pairMapKey(token.id, WHITELIST[i]));
    if (pairMap == null) continue;

    // pick the best pair from list based on highest reserve
    let pairIds = pairMap.pairIds;
    let bestPair: Pair | null = null;
    let bestPairReserve = ZERO_BD;
    if (token.id == NOTE_ADDRESS) {
      // only use wCANTO/NOTE pair for NOTE pricing
      pairIds = [NOTE_WCANTO_PAIR];
    }
    for (let j = 0; j < pairIds.length; j++) {
      let pair = Pair.load(pairIds[j]);
      if (pair == null) continue
      if (pair.reserveETH.gt(bestPairReserve)) {
        bestPair = pair;
        bestPairReserve = pair.reserveETH;
      }
    }
    if (bestPair != null) {
      let pair = bestPair;
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        if (token1 == null) continue
        return pair.token1Price.times(token1.derivedETH) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        if (token0 == null) continue
        return pair.token0Price.times(token0.derivedETH) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
