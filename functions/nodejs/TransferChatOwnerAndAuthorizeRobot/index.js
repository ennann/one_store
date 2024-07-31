// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const {newLarkClient} = require('../utils');
const lark = require('@larksuiteoapi/node-sdk');
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能
    logger.info(`${new Date()} 函数开始执行,入参为:${JSON.stringify(params)}`);
    // 新群主
    const newChatOwner = params.newChatOwner;
    // 历史群 id
    const historyChatId = params.historyChatId;

    //历史群名称
    const historyChatName = params.historyChatName;

    const historyChat = await application.data.object('object_history_feishu_chat')
        .select("_id","chat_name")
        .where({
            chat_id: historyChatId
        }).findOne();

    if (!historyChatId || !newChatOwner) {
        logger.error('historyChatId不能为空 或 newChatOwner不能为空');
        return {
            code: 2,
            msg: 'historyChatId不能为空  或 newChatOwner不能为空'
        }
    }

    // 创建飞书客户端
    const client = await newLarkClient({userId: context.user._id}, logger);

    // 历史群群成员列表
    let historyChatMember = [];
    try {
        // 获取当前群的群成员信息
        await (async () => {
            for await (const item of await client.im.chatMembers.getWithIterator({
                    path: {
                        chat_id: historyChatId,
                    },
                    params: {
                        member_id_type: 'user_id',
                    },
                }
            )) {
                console.log(item);
                const memberIds = item.items.map(item => item.member_id);
                historyChatMember.push(...memberIds);
            }
        })();
    } catch (e) {
        logger.error('获取群成员信息失败：', e);
        return {
            code: 3,
            msg: '获取群成员信息失败'
        }
    }
    logger.info(historyChatMember);

    // 首选把新机器人拉入为群，并设置为群管理员
    const appId = await application.globalVar.getVar("appId");

    if (!appId){
        logger.error('appId不能为空');
        return {
            code: 2,
            msg: 'appId不能为空'
        }
    }
    // 在 Redis 中获取历史群机器人 token
    let token = await baas.redis.get('historyChatToken');

    if (!token){
        const historyAppId = await baas.redis.get('historyAppId');
        const historyAppSecret = await baas.redis.get('historyAppSecret');

        //获取历史群机器人 token
        const tokenRes = await client.auth.tenantAccessToken.internal({
            data: {
                app_id: historyAppId,
                app_secret: historyAppSecret,
            },
        });
        // 获取失败的情况
        if (tokenRes.code !== 0) {
            logger.error("获取历史群应用机器人 Token 失败！")
            throw new Error('获取历史群应用机器人 Token 失败!');
        }

        token = tokenRes.tenant_access_token;
        // 数据存储到 Redis中一个半小时
        await baas.redis.setex('historyChatToken', 60 * 60 * 1.5, token);
    }
    // 判断新群主是否为群中人
    if (!historyChatMember.includes(newChatOwner._lark_user_id)) {
        //  不在群中，先把他拉到群里
        try {
            await client.im.chatMembers.create({
                    path: {
                        chat_id: historyChatId,
                    },
                    params: {
                        member_id_type: 'user_id',
                    },
                    data: {
                        id_list: [newChatOwner._lark_user_id],
                    },
                },
                lark.withTenantToken(token)
            )
        }catch (e){
            logger.error('拉新机器人进群失败：', e);
            return {
                code: 4,
                msg: '拉新机器人进群失败'
            }
        }
    }

    // 拉新机器人进群
    try {
        await client.im.chatMembers.create({
                path: {
                    chat_id: historyChatId,
                },
                params: {
                    member_id_type: 'app_id',
                },
                data: {
                    id_list: [appId],
                },
            },
            lark.withTenantToken(token)
        )
    }catch (e){
        logger.error('拉新机器人进群失败：', e);
        return {
            code: 4,
            msg: '拉新机器人进群失败'
        }
    }
    //     设置机器人为群管理员
    try {
        await client.im.chatManagers.addManagers({
                path: {
                    chat_id: historyChatId,
                },
                params: {
                    member_id_type: 'app_id',
                },
                data: {
                    manager_ids: [appId],
                },
            },
            lark.withTenantToken(token)
        )
    }catch (e) {
        logger.error('拉新机器人设置管理员失败：', e);
        return {
            code: 4,
            msg: '拉新机器人设置管理员失败'
        }
    }
    // 将机器人群主转移给人
    try {
        client.im.chat.update({
                path: {
                    chat_id: historyChatId,
                },
                params: {
                    user_id_type: 'user_id',
                },
                data: {
                    owner_id: newChatOwner._lark_user_id,
                },
            },
            lark.withTenantToken(token)
        )
    }catch (e) {
        logger.error('转移机器人群主失败：', e);
        return {
            code: 5,
            msg: '转移机器人群主失败'
        }
    }

    // 根据 chat_id 查找是否有群记录，如果
    let group_record = await application.data.object('object_feishu_chat').select('_id').where({ chat_id: historyChatId }).findOne();

    if (!group_record) {
        // 如果没有群记录，则创建一个
        group_record = await application.data.object('object_feishu_chat').create({
            chat_id: historyChatId,
            chat_name: historyChatName,
            is_store_chat: false,
            chat_owner: { id: newChatOwner._id }
        });
    }

    // 更新飞书历史群记录状态
    await application.data.object('object_history_feishu_chat').update(historyChat._id, {
        chat_owner: { id: newChatOwner._id },
        history_chat_authorize_status: 'option_authorization_not_associate'
    });

    return {
        code: 0,
        msg: '成功'
    }

}
