// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能
    // logger.info(`${new Date()} 函数开始执行`);
    // 在这里补充业务代码

    
};




/**
 * @description 生成机器人进群消息卡片按钮的 URL
 * @param {} context
 * @param {*} chat_id
 * @returns
 */
async function generateCardButtonUrl(context, chat_id, group_id) {
    const SCOPE = 'im:chat';
    const STATE = `setgroupadmin_user`;
    const { appId: APPID } = await application.integration.getDefaultTenantAccessToken();

    let BASE_URL = '';

    if (context.tenant.type === 4) {
        // 开发环境
        BASE_URL = 'https%3A%2F%2Fet6su6w956-dev29.aedev.feishuapp.cn%2Fae%2Fapps%2Fone_store__c%2Faadgdtfskbqhi';
    } else {
        // 线上环境
        BASE_URL = 'https%3A%2F%2Fet6su6w956.feishuapp.cn%2Fae%2Fapps%2Fone_store__c%2Faadgdtfskbqhi';
    }

    const REDIRECT_URI = `${BASE_URL}%3Fparams_var_RDE3AgWC%3D${chat_id}%26params_var_QrP6EhWe%3D${group_id}`;
    // %3Fparams_var_RDE3AgWC%3Doc_34e76ae070db2034746777a762f86439%26params_var_QrP6EhWe%3D1796560404246715

    return `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${APPID}&redirect_uri=${REDIRECT_URI}&scope=${SCOPE}&state=${STATE}`;
}
