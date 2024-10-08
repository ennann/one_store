// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const { newLarkClient, createLimiter, sleep } = require('../../utils');
const dayjs = require("dayjs");

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {


    const days = await application.globalVar.getVar("messageReadDays");
    const DB = application.data.object;
    const OP = application.operator;
    const BATCH_OBJECT = 'object_message_send'; //消息发送批次
    const RECORD_OBJECT = 'object_message_record'; //消息发送记录
    const READ_OBJECT = 'object_message_read_record'; //消息阅读记录
    const client = await newLarkClient({ userId: context.user._id }, logger);
    const timestamp = dayjs().subtract(days, 'day').startOf('day').valueOf();//获取6天前的时间戳

    // 获取飞书群成员
    const getChatMembers = async _id => {
        const chatMemberIds = [];
        await DB('object_chat_member')
            .where({ store_chat: { _id } })
            .select('_id', 'chat_member')
            .findStream(records => {
                const ids = records.map(i => i.chat_member._id);
                chatMemberIds.push(...ids);
            });
        return chatMemberIds;
    };

    // 获取群信息
    const getChatInfo = async chat => {
        const chat_record = await DB('object_feishu_chat').where({ _id: chat._id }).select('_id', 'chat_owner', 'chat_managers', 'chat_id').findOne();
        const chatMemberIds = await getChatMembers(chat_record._id);
        const allMemberIds = Array.from(
            new Set([...(chat_record.chat_managers.length > 0 ? chat_record.chat_managers.map(i => i?._id) : []), ...chatMemberIds, chat_record.chat_owner?._id].filter(Boolean)),
        );
        return allMemberIds;
    };

    // 获取消息已读人员
    const getReadUsers = async (message_id, page_token = '') => {
        const users = [];
        await sleep(60);
        logger.info('查询消息已读信息接口', message_id);
        try {
            const res = await client.im.message.readUsers({
                path: { message_id },
                params: {
                    page_token,
                    page_size: 100,
                    user_id_type: 'user_id',
                },
            });
            if (res.code !== 0) {
                throw new Error('查询消息已读信息接口报错, 消息为：', message_id);
            }
            users.push(...res.data.items);
            if (res.data.has_more) {
                const limitedGetReadUsers = createLimiter(getReadUsers);
                const moreUsers = await limitedGetReadUsers(message_id, res.data.page_token); // 使用限流后的函数
                users.push(...moreUsers);
            }
            return users;
        } catch (error) {
            logger.error('查询消息已读信息接口报错', message_id, error);
            throw new Error('查询消息已读信息接口报错', message_id, error);
        }
    };

    // 更新消息阅读记录
    const updateMessageRead = async (_id, readUsers) => {
        const readRecords = [];
        const userIds = readUsers.map(i => i.user_id);
        if (userIds.length > 0) {
            // 获取飞书消息已读，但是 apaas 记录未度的阅读记录
            await DB(READ_OBJECT)
                .where({
                    message_send_record: { _id },
                    read_status: 'option_unread',
                    accept_user: { _lark_user_id: OP.hasAnyOf(userIds) },
                })
                .select('_id')
                .findStream(records => readRecords.push(...records));
            if (readRecords.length > 0) {
                const updateReadResult = await Promise.all(
                    readRecords.map(({ _id }) =>
                        DB(READ_OBJECT).update({
                            _id,
                            read_status: 'option_read',
                        }),
                    ),
                );
            } else {
            }
        } else {
        }
    };

    // 过滤不在 apaas 群成员范围内的阅读成员
    const filterReadUsers = async (readUsers) => {
        let apaasUsers = [];
        if (readUsers.length > 0){
            for (let readUser of readUsers) {
                const userRecord = await application.data.object('_user').where({ _lark_user_id: readUser.user_id }).select('_id', '_department').findOne();
                if (userRecord){
                    // 若存在于 apaas 中的用户，则将其加入到 apaasUsers 数组中
                    apaasUsers.push(readUser);
                }
            }
        }
        return apaasUsers;
    }

    // 根据消息记录查询消息已读状态，更新消息记录
    const updateMessageRecord = async ({ _id, message_id, option_send_channel, message_chat, accept_user }) => {
        try {
            const readUsers = await getReadUsers(message_id);
            if (readUsers.length > 0) {
                let updateRecord = { _id };
                if (option_send_channel === 'option_user') {
                    // todo 个人信息发送阅读记录统计位置待处理
                    updateRecord = {
                        ...updateRecord,
                        read_count: 1,
                        // unread_count: accept_user.length - readUsers.length,
                        unread_count: 0,
                        read_status: readUsers.length === 0 ? 'option_unread' : accept_user.length === readUsers.length ? 'option_read' : 'option_partread',
                    };
                }
                if (option_send_channel === 'option_group') {
                    // 获取所有群成员 id
                    const chatMembers = await getChatInfo(message_chat);
                    //  todo 校验飞书阅读人是否在 apaas群成员中，再更新未读数
                    await updateMessageRead(_id, readUsers);

                    const inApaasReadUser = await filterReadUsers(readUsers);
                    updateRecord = {
                        ...updateRecord,
                        read_count: inApaasReadUser.length,
                        unread_count: chatMembers.length - inApaasReadUser.length,
                        read_status: readUsers.length === 0 ? 'option_unread' : chatMembers.length === readUsers.length ? 'option_read' : 'option_partread',
                    };
                }
                await DB(RECORD_OBJECT).update(updateRecord);
                return { code: 0 };
            } else {
                return { code: -2 };
            }
        } catch (error) {
            logger.error(`更新消息记录 ${_id} 失败`, error);
            return { code: -1 };
        }
    };

    // 通过批次下钻消息记录更新已读数量
    const updateRecordFun = async _id => {
        try {
            const msgList = await getMsgRecord(_id);
            if (msgList.length > 0) {
                const updateFun = createLimiter(updateMessageRecord);
                const result = await Promise.all(msgList.map(async (i, index) => {
                    await new Promise(resolve => {
                        setTimeout(async () => {
                            const res = await updateFun(i);
                            resolve(res);
                        }, index * 100); // 每次处理的间隔为 100 毫秒
                    });
                }));
                return { code: 0 };
            } else {
                return { code: -2 };
            }
        } catch (error) {
            logger.error(`更新批次 ${_id} 下的消息记录已读数量失败`, error);
            return { code: -1 };
        }
    };

    // 获取批次关联的消息发送记录，且未读数量不为0、阅读状态为未读/部分已读
    const getMsgRecord = async _id => {
        const msgRecords = [];
        await DB(RECORD_OBJECT)
            .where({
                message_batch: { _id },
                unread_count: OP.gte(0),
                read_status: OP.in('option_unread', 'option_partread'),
                _createdAt: OP.gte(timestamp)
            })
            .select('_id', 'message_id', 'option_send_channel', 'message_chat', 'accept_user')
            .findStream(records => msgRecords.push(...records));
        return msgRecords;
    };

    // 获取未读数量不为0且发送状态不为失败的批次
    const getBatchRecords = async () => {
        const batchRecords = [];
        await DB(BATCH_OBJECT)
            .where({
                unread_count: OP.gte(0),
                option_status: OP.in('option_all_success', 'option_part_success'),
            })
            .select('_id', 'batch_no')
            .findStream(records => batchRecords.push(...records));
        return batchRecords;
    };

    try {
        const batchList = await getBatchRecords();
        if (batchList.length > 0) {
            const updateFun = createLimiter(updateRecordFun, { perSecond: 2 });
            const result = await Promise.all(batchList.map(item => updateFun(item._id)));
            const successRes = result.filter(i => i.code === 0);
            const failRes = result.filter(i => i.code === -1);
            const noRunRes = result.filter(i => i.code === -2);
        } else {
        }
    } catch (error) {
        throw new Error('更新消息已读数量失败', error);
    }
};
