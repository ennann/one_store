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
    logger.info(`${new Date()} 用户进群事件函数开始执行`, params);

    // 事件飞书群
    const chatId = params.event.event.chat_id;
    // 事件对象
    const users = params.event.event.users;
    // 获取飞书群
    let chat;
    try {
         chat = await application.data.object('object_feishu_chat')
            .select('_id', 'is_store_chat', 'store')
            .where({chat_id: chatId})
            .findOne();
        logger.info(`${new Date()} 群信息`, chat);
    }catch (e) {
        logger.error(`${new Date()} 群信息不存在`, params);
    }

    if (!chat) {
        logger.error(`${new Date()} 群信息不存在`, params);
        return {
            code: 404,
            message: '群信息不存在'
        };
    }
    for (let user of users) {
        // 获取用户
        let userInfo;
        try {
            userInfo = await application.data.object('_user')
                .select('_id', '_name')
                .where({_lark_user_id: user.user_id.user_id})
                .findOne();
        } catch (e) {
            logger.error(`${new Date()} 用户信息不存在`, params);
        }
        if (!userInfo) {
            logger.error(`${new Date()} 用户信息不存在`, params);
            return {
                code: 404,
                message: '用户信息不存在'
            };
        }
        // 判断是否已经在飞书群成员中了
        let  chatMember;
        try {
            chatMember = await application.data.object('object_chat_member')
                .select('_id')
                .where({
                    store_chat: {_id: chat._id},
                    chat_member: {_id: userInfo._id}
                })
                .findOne();
        } catch (e){
            logger.error(`${new Date()} 查询用户是否在飞书群成员中失败`, e);
        }

        //将成员添加到相应的飞书群
        if (chatMember){
            logger.warn(`${new Date()} 用户已是飞书群的成员`)
            return {
                code: 500,
                message: '用户已是飞书群的成员'
            };
        }
        try {
            await application.data.object('object_chat_member').create({
                store_chat: {_id: chat._id},
                chat_member: {_id: userInfo._id},
                chat_member_role: 'option_group_member'
            });
        } catch (e) {
            logger.error(`${new Date()} 添加群成员失败`, e);
            return {
                code: 500,
                message: '添加群成员失败'
            };
        }
        //判断飞书群是否为门店群，如果是，则添加门店成员
        if (chat.is_store_chat) {
            logger.info(`${new Date()} 群信息为门店群`);
            try {
                await application.data.object('object_store_staff').create({
                    store: {_id: chat.store._id},
                    store_staff: {_id: userInfo._id}
                })
            }catch (e) {
                logger.error(`${new Date()} 添加门店成员失败`, e);
                return {
                    code: 500,
                    message: '添加门店成员失败'
                };
            }

        }
    }
}
