export enum CallBackQueries {
  CREATE_TOKEN = "create_token",
  VIEW_TOKENS = "view_tokens",
  LAUNCH_TOKEN = "launch_token",
  ADD_WALLET = "add_wallet",
  GENERATE_WALLET = "generate_wallets",
  UPDATE_DEV_WALLET = "update_dev_wallet",
  EXPORT_DEV_WALLET = "export_dev_wallet",
  SELL_ALL = "sell_all",
  SELL_DEV = "sell_dev",
  SELL_PERCENT = "sell_percent",
  WALLET_CONFIG = "wallet_config",
  BACK = "back",
  MENU = "menu",

  CHANGE_FUNDING_WALLET = "change_funding_wallet",
  CANCEL_FUNDING_WALLET = "cancel_funding_wallet",

  DELETE_DEV = "delete_dev",
  DEFAULT_DEV = "default_dev",
  SELECT_DEV = "select_dev",

  CHANGE_DEV_WALLET = "change_dev_wallet",
  ADD_DEV_WALLET = "add_dev_wallet",
  GENERATE_DEV_WALLET = "generate_dev_wallet",
  IMPORT_DEV_WALLET = "import_dev_wallet",
  CANCEL_DEV_WALLET = "cancel_dev_wallet",

  GENERATE_FUNDING_WALLET = "generate_funding_wallet",

  MANAGE_BUYER_WALLETS = "manage_buyer_wallets",
  ADD_BUYER_WALLET = "add_buyer_wallet",
  GENERATE_BUYER_WALLET = "generate_buyer_wallet",
  IMPORT_BUYER_WALLET = "import_buyer_wallet",
  DELETE_BUYER_WALLET = "delete_buyer_wallet",
  EXPORT_BUYER_WALLET = "export_buyer_wallet",
  CANCEL_BUYER_WALLET = "cancel_buyer_wallet",
  // Withdrawal options
  WITHDRAW_BUYER_WALLETS = "withdraw_buyer_wallets",
  WITHDRAW_DEV_WALLET = "withdraw_dev_wallet",
  WITHDRAW_FUNDING_WALLET = "withdraw_funding_wallet",
  WITHDRAW_TO_FUNDING = "withdraw_to_funding",
  WITHDRAW_TO_EXTERNAL = "withdraw_to_external",
  CANCEL_WITHDRAWAL = "cancel_withdrawal",
  // Retry options
  RETRY_LAUNCH = "retry_launch",

  WITHDRAW_SOL = "withdraw_sol",
  WITHDRAW_TOKEN = "withdraw_token",

  // Token deletion
  DELETE_TOKEN = "delete_token",
  CONFIRM_DELETE_TOKEN = "con_del_token",

  // ←–– Newly added callbacks for pagination and generic cancel
  PREV_TOKEN = "prev_token",
  NEXT_TOKEN = "next_token",
  NOOP = "noop",
  CANCEL = "cancel",

  // Affiliate system
  VIEW_REFERRALS = "view_referrals",
  CANCEL_EXTERNAL_BUY = "cancel_external_buy",
  BUY_EXTERNAL_TOKEN = "buy_token",
  SELL_EXTERNAL_TOKEN = "sell_token",
  VIEW_TOKEN_DETAILS = "view_token_details",
  SELL_DEV_SUPPLY = "sell_dev_supply",
  SELL_WALLET_SUPPLY = "sell_wallet_supply",

  SELL_INDIVIDUAL = "sell_individual",

  VIEW_TOKEN_TRADES = "view_token_trades",
  CTO = "cto",
  PUMPFUN = "pumpfun",
  LETSBONK = "letsbonk",
}
