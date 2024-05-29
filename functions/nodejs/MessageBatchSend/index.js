const dayjs = require('dayjs');
const { createLimiter, newLarkClient } = require('../utils');

module.exports = async function (params, context, logger) {
    logger.info(`批量发送消息 函数开始执行`, params);

    const { record } = params;
    const KEY = record._id;
    const redisValue = await baas.redis.get(KEY);

    if (redisValue) {
        logger.error('已存在执行中发送消息任务');
        return { code: -1, message: '已存在执行中发送消息任务' };
        // throw new Error('已存在执行中发送消息任务');
    }

    let sendIds = [];

    // 创建消息发送批次记录
    const createSendRecord = async () => {
        // 查找数据库中是否有发送批次记录
        try {
            // 从数据库中查找最新的消息批从记录，判断当天是否生成过消息批次记录，如果生成过则不再生成
            let messageBatchRecord = await application.data
                .object('object_message_send')
                .select('_id', 'batch_no', 'send_start_datetime')
                .where({ message_send_def: record._id || record.id })
                .orderByDesc('send_start_datetime')
                .findOne();

            if (messageBatchRecord) {
                const send_start_datetime = dayjs(messageBatchRecord.send_start_datetime);
                if (send_start_datetime.isAfter(dayjs().startOf('day'))) {
                    logger.error('当天已有消息发送批次记录');
                    return { code: -1, message: '当天已有消息发送批次记录' };
                }
            }
        } catch (error) {
            logger.error('查询消息发送批次记录失败', error);
            return { code: -1, message: '查询消息发送批次记录失败' };
        }

        // 创建消息发送批次记录
        try {
            const batch_no = await faas.function('MessageGenerateBatchNumber').invoke({ record });
            const createData = {
                batch_no,
                option_status: 'option_sending',
                message_send_def: { _id: record._id },
                send_start_datetime: dayjs().valueOf(),
            };
            const res = await application.data.object('object_message_send').create(createData);
            logger.info('创建消息发送批次成功', res);
            return { code: 0, recordId: res._id, batch_no };
        } catch (error) {
            logger.error('创建消息发送批次失败', error);
            return { code: -1, message: '创建消息发送批次失败' };
        }
    };

    // 消息卡片内容生成
    let messageContent;
    try {
        messageContent = await faas.function('MessageContentGenerator').invoke({ record });
    } catch (error) {
        logger.error('消息卡片内容生成失败，请关注功能。失败原因：', error);
        return { code: -1, message: '消息卡片内容生成失败' };
    }

    // 发送消息，从 messageContent 解构出卡片内容，接收方类型

    // 创建飞书SDK客户端
    const client = await newLarkClient({ userId: context.user._id }, logger);

    const sendMessage = async receive_id => {
        const paramsData = { ...messageContent, receive_id };

        // logger.info({ paramsData });
        try {
            const res = await faas.function('MessageCardSend').invoke({ ...paramsData, client });
            return { ...res, receive_id };
        } catch (error) {
            logger.error(`发送消息失败 - `, paramsData, error);
            return { code: -1, message: error.message, receive_id };
        }
    };

    try {
        if (!record.send_channel) {
            logger.error('没有选择飞书发送渠道');
            return { code: -1, message: '没有选择飞书发送渠道' };
        }

        if (record.send_channel === 'option_group') {
            if (!record.chat_rule) {
                logger.error('缺少群组筛选规则');
                return { code: -1, message: '缺少群组筛选规则' };
                // throw new Error('缺少群组筛选规则');
            }
            const chatRecordList = await faas.function('DeployChatRange').invoke({ deploy_rule: record.chat_rule });
            logger.info(`筛选到的群组数量: ${chatRecordList.length}`, chatRecordList);
            sendIds = chatRecordList.map(i => i.chat_id);
            logger.info(`筛选到的群组数量: ${sendIds.length}`, sendIds);
        }

        if (record.send_channel === 'option_user') {
            if (!record.user_rule) {
                logger.error('缺少人员筛选规则');
                return { code: -1, message: '缺少人员筛选规则' };
            }
            const userList = await faas.function('DeployMemberRange').invoke({ user_rule: record.user_rule });
            sendIds = userList.map(i => i.user_id);
            logger.info(`筛选到的人员数量: ${sendIds.length}，人员ID列表`, sendIds);
        }

        if (sendIds.length > 0) {
            const { code, recordId, message, batch_no } = await createSendRecord(); // 创建消息批次记录

            if (code !== 0) {
                return { code, message: '创建消息发送批次失败，原因：' + message };
            }

            await baas.redis.set(KEY, new Date().getTime());

            const limitSendMessage = createLimiter(sendMessage);
            logger.info({ sendIds });
            const sendMessageResult = await Promise.all(sendIds.map(id => limitSendMessage(id)));

            const successRecords = sendMessageResult.filter(result => result?.code === 0);
            const failRecords = sendMessageResult.filter(result => result?.code !== 0);
            logger.info(
                `批量发送消息函数发送消息完成，接下来开始存储记录。消息总数：${sendMessageResult.length}; 成功消息数：${successRecords.length}; 失败消息数：${failRecords.length}`,
            );

            let option_status;
            if (successRecords.length === sendMessageResult.length) {
                option_status = 'option_all_success';
            } else if (failRecords.length === sendMessageResult.length) {
                option_status = 'option_fail';
            } else {
                option_status = 'option_part_success';
            }

            // 更新消息发送批次记录
            if (recordId) {
                try {
                    const updateData = {
                        _id: recordId,
                        option_status,
                        send_count: sendIds.length,
                        success_count: successRecords.length,
                        fail_count: failRecords.length,
                        send_end_datetime: dayjs().valueOf(),
                        msg_type: messageContent.msg_type,
                        message_content: messageContent.content,
                    };
                    logger.info(`更新消息发送批次记录`, updateData);
                    await application.data.object('object_message_send').update(updateData);

                    const res = await baas.tasks.createAsyncTask('MessageSendRecordCreate', {
                        message_send_result: sendMessageResult, // 消息发送结果
                        message_send_batch: { _id: recordId }, // 消息发送批次
                        message_define: record, // 消息定义记录
                    });

                    logger.info('更新消息发送批次成功, 执行创建消息发送记录异步任务结果', { res });
                    return { code: 0, message: '批量发送消息成功' };
                } catch (error) {
                    logger.error('更新消息发送批次失败', error);
                    return { code: -1, message: '更新消息发送批次失败' + error.message };
                    // throw new Error('创建消息发送记录失败', error);
                }
            }
        }
    } catch (error) {
        logger.error('批量发送消息失败', error);
        return { code: -1, message: error.message };
        // throw error;
    } finally {
        await baas.redis.del(KEY);
    }
};
