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
    let key = params.key;
    logger.info(`key:${key}`);
    if (key) {
        let result = await baas.redis.get(key);

        if (result) {

            switch (key) {
                case  "GroupBotDeploy":
                    return {
                        msg: "群机器人分发正在执行，请稍后再试",
                        flag: false
                    };
                case "GroupTabDeploy":
                    return {
                        msg: "群置顶分发正在执行中，请稍后再试",
                        flag: false
                    };
                case "GroupMenuDeploy":
                    return {
                        msg: "群会话菜单分发正在执行中，请稍后重试",
                        flag: false
                    }
                default:
                    logger.error('未知的事件类型，请检查');
                    return {
                        flag: false,
                        msg: '未知的事件类型，请检查',
                    };
            }

        }

    }
    return {
        msg: " 可执行",
        flag: true
    }
}
