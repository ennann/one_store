
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info(`接收飞书事件函数开始执行 ${new Date()}`);

    logger.info(params);
    const event_type = params?.event?.header?.event_type;

    // 第一步首先判断是否有 event_type 字段，如果有，才进行到下一步的 switch 判断
    if (!event_type) {
        logger.error('本次事件中，没有 event_type 字段，请检查');
        return {
            code: -1,
            msg: '本次事件中，没有事件类型字段，请检查参数是否正确',
        };
    }

    // 如果有 event_type 字段，再判断是哪种类型的事件
    logger.info('事件类型:', event_type);

    switch (event_type) {
        case 'im.chat.member.bot.added_v1':
            // im.chat.member.bot.added_v1 机器人进群事件
            logger.info('本次事件：机器人进入群聊事件');
            await faas.function('EventBotAddToChat').invoke(params);
            logger.info('机器人进入群聊事件处理完成');
            break;

        case 'card.action.trigger':
            // card.action.trigger 消息卡片按钮被点击事件
            logger.info('本次事件：用户点击消息卡片按钮，入参：', params);
            break;

        case 'im.message.receive_v1':
            // im.message.receive_v1 消息接收事件，群聊中的 at 或者用户的私聊
            logger.info('本次事件：用户向机器人发送消息事件');
            break;
        
        case 'contact.user.created_v3':
            // contact.user.created_v3 用户信息创建事件
            logger.info('本次事件：用户信息创建事件');
            await faas.function('EventUserCreate').invoke(params);
            break;
        
        case 'contact.user.deleted_v3':
            // contact.user.deleted_v3 用户信息删除事件
            logger.info('本次事件：用户信息删除事件');
            await faas.function('EventUserDelete').invoke(params);
            break;

        case 'contact.user.updated_v3':
            // contact.user.updated_v3 用户信息更新事件
            logger.info('本次事件：用户信息更新事件');
            await faas.function('EventUserInfoChange').invoke(params);
            logger.info('用户信息更新事件处理完成');
            break;

        default:
            logger.error('未知的事件类型，请检查');
            return {
                code: 400,
                msg: '未知的事件类型，请检查',
            };
    }
};