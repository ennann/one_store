// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const {createLimiter, newLarkClient} = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能
    logger.info(`预览信息发送 函数开始执行`, params);
    let {record} = params; // 消息定义记录
    record.send_channel = "option_user";

    // 创建飞书SDK客户端
    const client = await newLarkClient({userId: context.user._id}, logger);

    // 消息卡片内容生成
    let messageContent;
    try {
        messageContent = await faas.function('MessageContentGenerator').invoke({record});
    } catch (error) {
        logger.error('消息卡片内容生成失败，请关注功能。失败原因：', error);
        return {code: -1, message: '消息卡片内容生成失败'};
    }

    // 发送消息，从 messageContent 解构出卡片内容，接收方类型
    const sendMessage = async (receive_id, client) => {
        try {
            const res = await faas.function('MessageCardSend').invoke({ ...messageContent, receive_id, client });
            return { ...res, receive_id };
        } catch (error) {
            logger.error(`发送消息失败 - `, paramsData, error);
            return { code: -1, message: error.message, receive_id };
        }
    };

    try {
        // const limitSendMessage = createLimiter(sendMessage, { perSecond: 30, perMinute: 500 });

        const userId = context.user._id;

        // 根据 userIds 从用户表中查询用户信息
        let userRecords = await application.data
            .object('_user')
            .select('_lark_user_id')
            .where({ _id: userId })
            .findOne();

        logger.info(`查询用户信息完成，用户信息：${userRecords._lark_user_id};`,)

        const sendMessageResult = await sendMessage(userRecords._lark_user_id, client);

        logger.info(
            `预览发送消息完成，发送情况。：${sendMessageResult};`,
        );
    } catch (error) {
        logger.error('批量发送消息失败', error);
        return { code: -1, message: error.message };
    }
}
