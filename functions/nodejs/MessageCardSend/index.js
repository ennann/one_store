const { newLarkClient } = require('../utils');
// todo: 确认函数修改后的影响范围

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    const { receive_id_type, receive_id, msg_type, content } = params;
    const receiveIdTypes = new Set(['open_id', 'user_id', 'email', 'union_id', 'chat_id']);

    // 判断 receive_id_type 是否合法
    if (!receiveIdTypes.has(receive_id_type)) {
        logger.error(`错误的 receive_id_type 类型: ${receive_id_type}`);
        return { code: -1, message: '错误的 receive_id_type 类型' };
    }

    // 判断 receive_id 和 content 是否为空
    if (!receive_id || !msg_type || !content) {
        logger.error(`receive_id 或 content 不能为空. Received - receive_id: ${receive_id}, msg_type: ${msg_type}, content: ${content}`);
        return { code: -1, message: 'receive_id 或 content 不能为空' };
    }

    const client = await newLarkClient({ userId: context.user._id }, logger);
    try {
        let response = await client.im.message.create({
            params: { receive_id_type },
            data: {
                receive_id,
                msg_type,
                content,
            },
        });

        if (response.code !== 0) {
            logger.error('消息发送失败', response);
            return { code: -1, message: '消息发送失败，原因：' + response.message };
        }
        // 处理返回结果，根据后面所需要的数据，将 response 进行精简处理
        // 正常情况下返回 { code: 0, message: '消息发送成功' }
        return {
            code: response.code,
            data: {
                message_id: response.data.message_id,
                chat_id: response.data.chat_id,
            },
            receive_id,
        };
    } catch (e) {
        logger.error('消息发送', e);
        return { code: -1, message: '消息发送失败，原因：' + e.message };
    }
};

/* 正常返回内容如下
{
  "code": 0,
  "data": {
    "body": {
      "content": "{\"text\":\"test content\"}"
    },
    "chat_id": "oc_7ba2f003fa60ea3e6761052986361ea7",
    "create_time": "1716965610376",
    "deleted": false,
    "message_id": "om_6a479546c6ef4e287166d53f273d26bc",
    "msg_type": "text",
    "sender": {
      "id": "cli_a6b23873d463100b",
      "id_type": "app_id",
      "sender_type": "app",
      "tenant_key": "10de27cde1ae975d"
    },
    "update_time": "1716965610376",
    "updated": false
  },
  "msg": "success"
}
*/
