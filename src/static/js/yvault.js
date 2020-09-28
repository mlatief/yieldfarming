$(function() {
    consoleInit();
    start(main);
});

async function main() {

    const App = await init_ethers();

    _print(`Initialized ${App.YOUR_ADDRESS}`);
    _print("Reading smart contracts...");

    const YEARN_VAULT_CONTROLLER = new ethers.Contract(YEARN_VAULT_CONTROLLER_ADDR, YEARN_VAULT_CONTROLLER_ABI, App.provider);
    const YAERN_DELEGATED_VAULT_CONTROLLER = new ethers.Contract(YEARN_DELEGATED_VAULT_CONTROLLER_ADDR, YEARN_DELEGATED_VAULT_CONTROLLER_ABI, App.provider);

    const CURVE_Y_POOL = new ethers.Contract(CURVE_Y_POOL_ADDR, CURVE_Y_POOL_ABI, App.provider);
    const CURVE_B_POOL = new ethers.Contract(CURVE_B_POOL_ADDR, CURVE_B_POOL_ABI, App.provider);
    const CURVE_BTC_POOL = new ethers.Contract(CURVE_BTC_POOL_ADDR, CURVE_BTC_POOL_ABI, App.provider);

    // const currentBlockTime = await getBlockTime();
    // const oneDayInBlocks = 24 * 60 * 60 / currentBlockTime;
    // const oneWeekInBlocks = oneDayInBlocks * 7;
    const now = Math.round(Date.now() / 1000);

    // const currentBlockNumber = await App.provider.getBlockNumber();
    const oneDayAgoBlockNumber = parseInt(await getBlockNumberFromTimestamp(now - 60 * 60 * 24));
    const oneWeekAgoBlockNumber = parseInt(await getBlockNumberFromTimestamp(now - 60 * 60 * 24 * 7));

    console.log(oneDayAgoBlockNumber);
    console.log(oneWeekAgoBlockNumber);

    const prices = await lookUpPrices(["usd-coin", "dai", "true-usd", "tether", "usd-coin", "chainlink", 'yearn-finance', 'bitcoin', "weth"]);

    const vaultCompatibleTokens = [
        ["yCRV", (await CURVE_Y_POOL.get_virtual_price()) / 1e18 , YCRV_TOKEN_ADDR],
        ["ybCRV", (await CURVE_B_POOL.get_virtual_price()) / 1e18 , YBCRV_TOKEN_ADDR],
        ["crvRenWSBTC", ((await CURVE_BTC_POOL.get_virtual_price()) / 1e18) * prices['bitcoin'].usd , crvRenWSBTC_TOKEN_ADDR],
        ["YFI", prices['yearn-finance'].usd, YFI_TOKEN_ADDR],
        ["DAI", prices['dai'].usd ,DAI_TOKEN_ADDR],
        ["TUSD", prices['true-usd'].usd ,TUSD_TOKEN_ADDR],
        ["USDC", prices['usd-coin'].usd ,USDC_TOKEN_ADDR],
        ["USDT", prices['tether'].usd,USDT_TOKEN_ADDR],
        ["WETH", prices['weth'].usd,WETH_TOKEN_ADDR],
    ];

    const delegatedVaultCompatibleTokens = [
        ["aLINK", prices['chainlink'].usd, ALINK_VAULT_ADDR]
        // ["LINK", prices['chainlink'].usd, ALINK_VAULT_ADDR]
    ];


    const vaults = await Promise.all(vaultCompatibleTokens.map(async function(token) {
        const tokenTicker = token[0];
        const tokenPrice = token[1];
        const tokenAddr = token[2];

        const vaultAddress = await YEARN_VAULT_CONTROLLER.vaults(tokenAddr);
        const tokenContract = new ethers.Contract(tokenAddr, ERC20_ABI, App.provider);
        const vaultContract = new ethers.Contract(vaultAddress, YEARN_VAULT_ABI, App.provider);
        const currentPricePerFullShare = await vaultContract.getPricePerFullShare();
        const decimals = parseInt(await tokenContract.decimals())

        const tokenBalance = (await vaultContract.balance()) / (10 ** decimals);

        const strategyAddr = await YEARN_VAULT_CONTROLLER.strategies(tokenAddr);
        let strategyName = 'DForceUSDC';
        if(!['USDC'].includes(tokenTicker)) {
            try {
                const strategyContract = new ethers.Contract(strategyAddr, YEARN_STRATEGY_ABI, App.provider);
                strategyName = await strategyContract.getName();
                strategyName = strategyName.replace(/^Strategy/, '');
            } catch(ex) {
                console.error(ex);
                strategyName = strategyAddr;
            }
        }

        let tokenBalanceDayAgo = 0;
        try {
            tokenBalanceDayAgo = await vaultContract.balance({blockTag : oneDayAgoBlockNumber}) / (10 ** decimals);
        } catch (e) {
            console.error(e);
        }

        let ROI_day = 0;
        let ROI_week = 0;

        try {
            const pastPricePerFullShare = await vaultContract.getPricePerFullShare({blockTag : oneDayAgoBlockNumber});
            ROI_day = (currentPricePerFullShare / pastPricePerFullShare - 1) * 100;
        } catch (e) {
            console.error(e);
        }

        try {
            const pastPricePerFullShare = await vaultContract.getPricePerFullShare({blockTag : oneWeekAgoBlockNumber});
            ROI_week = (currentPricePerFullShare / pastPricePerFullShare - 1) * 100;
        } catch (e) {
            console.error(e);
        }

        return {
            tokenTicker : tokenTicker,
            tokenAddr : tokenAddr,
            tokenPrice : tokenPrice,
            tokenContractInstance: tokenContract,
            vaultContractInstance: vaultContract,
            vaultTicker : await vaultContract.symbol(),
            tokenBalance : tokenBalance,
            tokenBalanceDayAgo : tokenBalanceDayAgo,
            balanceInUSD : tokenBalance * tokenPrice,
            currentPricePerFullShare : currentPricePerFullShare,
            ROI_day: ROI_day,
            ROI_week: ROI_week,
            strategyAddr : strategyAddr,
            strategyName : strategyName,
        }
    }));

    console.log("VAULT 1.0 data gathered.")

    const delegatedVaults = await Promise.all(delegatedVaultCompatibleTokens.map(async function(token) {
        const tokenTicker = token[0];
        const tokenPrice = token[1];
        const delegatedVaultAddr = token[2];

        const delegatedVaultContract = new ethers.Contract(delegatedVaultAddr, DELEGATED_VAULT_ABI, App.provider);

        const tokenAddr = await delegatedVaultContract.underlying();
        const tokenContract = new ethers.Contract(tokenAddr, ERC20_ABI, App.provider);

        const decimals = parseInt(await tokenContract.decimals())

        const tokenBalance = await delegatedVaultContract.balance() / (10 ** decimals);
        let tokenBalanceDayAgo = 0;
        try {
            tokenBalanceDayAgo = await delegatedVaultContract.balance({blockTag : oneDayAgoBlockNumber}) / (10 ** decimals);
        } catch (e) {
            console.error(e);
        }

        const currentPricePerFullShare = await delegatedVaultContract.getPricePerFullShare();

        let ROI_day = 0;
        let ROI_week = 0;

        try {
            const pastPricePerFullShare = await delegatedVaultContract.getPricePerFullShare({blockTag : oneDayAgoBlockNumber});
            ROI_day = (currentPricePerFullShare / pastPricePerFullShare - 1) * 100;
        } catch (e) {
            console.error(e);
        }

        try {
            const pastPricePerFullShare = await delegatedVaultContract.getPricePerFullShare({blockTag :oneWeekAgoBlockNumber});
            ROI_week = (currentPricePerFullShare / pastPricePerFullShare - 1) * 100;
        } catch (e) {
            console.error(e);
        }

        return {
            tokenTicker : tokenTicker,
            tokenAddr : await delegatedVaultContract.underlying(),
            tokenPrice : tokenPrice,
            tokenContractInstance: tokenContract,
            vaultContractInstance: delegatedVaultContract,
            vaultTicker : await delegatedVaultContract.symbol(),
            tokenBalance : tokenBalance,
            tokenBalanceDayAgo : tokenBalanceDayAgo,
            balanceInUSD : tokenBalance * tokenPrice,
            currentPricePerFullShare : currentPricePerFullShare,
            ROI_day: ROI_day,
            ROI_week: ROI_week,
            strategyAddr : await YAERN_DELEGATED_VAULT_CONTROLLER.strategies(delegatedVaultAddr),
            strategyName : "" // TODO: Create lambda that queries ContractName from etherscan
        }

    }));

    console.log("VAULT 2.0 data gathered.")
    // Start printing data

    let totalValueLocked = 0;
    let dayProfitGenerated = 0;
    for (let i = 0; i < vaults.length; i++) {
        totalValueLocked += vaults[i].balanceInUSD;
        dayProfitGenerated += (vaults[i].tokenBalanceDayAgo * vaults[i].tokenPrice) * vaults[i].ROI_day / 100
    }

    for (let i = 0; i < delegatedVaults.length; i++) {
        totalValueLocked += delegatedVaults[i].balanceInUSD;
        dayProfitGenerated += (vaults[i].tokenBalanceDayAgo * vaults[i].tokenPrice) * vaults[i].ROI_day / 100
    }

    _print_bold(`\nTotal Value Locked         : ${toDollar(totalValueLocked)}`);
    _print_bold(`Profit generated in 24 hrs : ${toDollar(dayProfitGenerated)}\n`);

    _print_bold("                                __    __              __         ______  \n" +
        "                               /  |  /  |           _/  |       /      \\ \n" +
        " __     __   ______   __    __ $$ | _$$ |_         / $$ |      /$$$$$$  |\n" +
        "/  \\   /  | /      \\ /  |  /  |$$ |/ $$   |        $$$$ |      $$$  \\$$ |\n" +
        "$$  \\ /$$/  $$$$$$  |$$ |  $$ |$$ |$$$$$$/           $$ |      $$$$  $$ |\n" +
        " $$  /$$/   /    $$ |$$ |  $$ |$$ |  $$ | __         $$ |      $$ $$ $$ |\n" +
        "  $$ $$/   /$$$$$$$ |$$ \\__$$ |$$ |  $$ |/  |       _$$ |_  __ $$ \\$$$$ |\n" +
        "   $$$/    $$    $$ |$$    $$/ $$ |  $$  $$/       / $$   |/  |$$   $$$/ \n" +
        "    $/      $$$$$$$/  $$$$$$/  $$/    $$$$/        $$$$$$/ $$/  $$$$$$/  \n" +
        "                                                                         \n");


    for (let i = 0; i < vaults.length; i++) {
        const vault = vaults[i]
        await printVault(vault, App);
    }

    _print_bold("                                __    __             ______        ______  \n" +
        "                               /  |  /  |           /      \\      /      \\ \n" +
        " __     __   ______   __    __ $$ | _$$ |_         /$$$$$$  |    /$$$$$$  |\n" +
        "/  \\   /  | /      \\ /  |  /  |$$ |/ $$   |        $$____$$ |    $$$  \\$$ |\n" +
        "$$  \\ /$$/  $$$$$$  |$$ |  $$ |$$ |$$$$$$/          /    $$/     $$$$  $$ |\n" +
        " $$  /$$/   /    $$ |$$ |  $$ |$$ |  $$ | __       /$$$$$$/      $$ $$ $$ |\n" +
        "  $$ $$/   /$$$$$$$ |$$ \\__$$ |$$ |  $$ |/  |      $$ |_____  __ $$ \\$$$$ |\n" +
        "   $$$/    $$    $$ |$$    $$/ $$ |  $$  $$/       $$       |/  |$$   $$$/ \n" +
        "    $/      $$$$$$$/  $$$$$$/  $$/    $$$$/        $$$$$$$$/ $$/  $$$$$$/  \n" +
        "                                                                           \n");

    for (let i = 0; i < delegatedVaults.length; i++) {
        const vault = delegatedVaults[i]
        await printVault(vault, App);
    }

    // await _print24HourPrice("yearn-finance", "YFI");

    hideLoading();
}


const printVault = async function(vault, App) {
    const decimal = 10**(await vault.vaultContractInstance.decimals());
    const yourVaultTokenAmount = (await vault.vaultContractInstance.balanceOf(App.YOUR_ADDRESS) ) / decimal;
    const yourVaultTokenInUnderlyingTokenAmount = yourVaultTokenAmount * vault.currentPricePerFullShare / 1e18;

    const yourDailyGains = yourVaultTokenInUnderlyingTokenAmount * vault.ROI_day / 100;
    const yourWeeklyGains = yourVaultTokenInUnderlyingTokenAmount * vault.ROI_week / 100;

    _print(`================== ${vault.tokenTicker} ================== `);
    _print(`1 ${trimOrFillTo(vault.tokenTicker, 15)} = $${vault.tokenPrice}`);
    _print(`1 ${trimOrFillTo(vault.vaultTicker, 15)} = ${toFixed(vault.currentPricePerFullShare / 1e18, 6)} ${vault.tokenTicker}\n`);
    _print_href(`Current strategy  : ${vault.strategyName}`, `https://etherscan.io/address/${vault.strategyAddr}#code`);

    _print('');

    _print(`There are total   : ${vault.tokenBalance} ${vault.tokenTicker} staked in ${vault.tokenTicker} vault`);
    _print(`                  = ${toDollar(vault.balanceInUSD)}\n`);
    _print(`You own           : ${yourVaultTokenAmount} ${trimOrFillTo(vault.vaultTicker, 15)}\n`);
    _print(`You are staking   : ${yourVaultTokenInUnderlyingTokenAmount} ${vault.tokenTicker}`);
    _print(`                  = ${toDollar(yourVaultTokenInUnderlyingTokenAmount * vault.tokenPrice)}\n`);

    if (yourVaultTokenAmount * vault.tokenPrice > 1) {
        const histDailyDecimals = decimalsForSmallNumber(yourDailyGains);
        _print(`Hist. Daily ROI   : ${toFixed(vault.ROI_day, 4)}% (${toFixed(yourDailyGains, histDailyDecimals)} ${vault.tokenTicker})`);
        _print(`                  = ${toDollar(toFixed(yourDailyGains, histDailyDecimals) * vault.tokenPrice)}\n`);

        const histWeeklyDecimals = decimalsForSmallNumber(yourDailyGains);
        _print(`Hist. Weekly ROI  : ${toFixed(vault.ROI_week, 4)}% (${toFixed(yourWeeklyGains, histWeeklyDecimals)} ${vault.tokenTicker})`);
        _print(`                  = ${toDollar(toFixed(yourWeeklyGains, histWeeklyDecimals) * vault.tokenPrice)}\n`);
    } else {
        _print(`Hist. Daily ROI   : ${toFixed(vault.ROI_day, 4)}%`);
        _print(`Hist. Weekly ROI  : ${toFixed(vault.ROI_week, 4)}%\n`);
    }

    _print(`APY (daily)       : ${toFixed(((1 + (vault.ROI_day / 100))**365 - 1) * 100, 4)}%`);
    _print(`APY (weekly)      : ${toFixed(((1 + (vault.ROI_week / 100))**52 - 1) * 100, 4)}% \n\n`);
};
