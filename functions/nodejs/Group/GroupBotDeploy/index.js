const { newLarkClient, createLimiter } = require('../../utils');

/**
 *
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数
 * @param {Logger}  logger     日志记录器
 * @return {Object} 返回处理结果
 */
module.exports = async function (params, context, logger) {

  const { chat_bot } = params;
  if (!chat_bot || !chat_bot._id) {
    logger.error('错误：缺少群机器人信息');
    return { code: -1, message: '错误：缺少群机器人信息' };
  }
  // deleteFeiShuGroupBot(chat_bot,logger);
  // 调用函数获取群机器人的群聊ID列表
  const chatRecordList = await faas.function('DeployChatRange').invoke({ deploy_rule: chat_bot.chat_rule });
  const chatIdList = chatRecordList.map(item => item.chat_id);

  if (!chatIdList || chatIdList.length === 0) {
    logger.error('查询结果为空，未找到对应的群聊');
    return { code: -2, message: '未找到对应的群聊，无法分发' };
  }

  // 获取机器人信息并创建客户端实例
  const { bot_app_id } = chat_bot;
  const client = await newLarkClient({ userId: context.user._id }, logger);

  // 定义将机器人添加到群聊的函数
  const addBotToChat = async (chat_id, bot_app_id) => {
    try {
      const response = await client.im.chatMembers.create({
        path: { chat_id },
        params: {
          member_id_type: 'app_id',
          succeed_type: 0,
        },
        data: {
          id_list: [bot_app_id],
        },
      });

      if (response.code !== 0) {
        throw new Error(`机器人 ${bot_app_id} 加入群聊 ${chat_id} 失败，错误信息：${response.msg}`);
      }

      return { code: 0, chat_id, bot_app_id, message: '机器人加入群聊成功', result: 'success' };
    } catch (error) {
      return { code: -1, chat_id, bot_app_id, message: error.message, result: 'failed' };
    }
  };

  // 创建限流器
  const limitedAddBotToChat = createLimiter(addBotToChat);

  // 并行执行机器人添加到群聊的操作
  const addBotResults = await Promise.all(chatIdList.map(chat_id => limitedAddBotToChat(chat_id, bot_app_id)));

  // 处理成功和失败的结果
  const successList = addBotResults.filter(item => item.code === 0);
  const failedList = addBotResults.filter(item => item.code !== 0);


  // 根据成功列表准备批量创建数据关系
  const batchCreateData = successList.map(item => ({
    union_id: `${bot_app_id}-${item.chat_id}`,
    bot: { _id: chat_bot._id },
    chat: { _id: chatRecordList.find(chat => chat.chat_id === item.chat_id)._id },
  }));

  // 创建一个函数，机器人和群的关系
  const createBotChatRelation = async (data) => {
    try {
      await application.data.object('object_chat_bot_relation').create(data);
      return { code: 0, message: '创建关系成功', result: 'success' };
    } catch (error) {
      return { code: -1, message: error.message, result: 'failed' };
    }
  }

  // 并行执行创建关系的操作
  const createRelationResults = await Promise.all(batchCreateData.map(data => createBotChatRelation(data)));

  if (failedList.length > 0) {
    throw new Error(`分发群机器人失败，请联系管理员！`);
  }
  return {
    code: successList.length > 0 ? 0 : -1,
    message: '群机器人分发完成',
    data: {
      success_count: successList.length,
      success_list: successList,
      failed_count: failedList.length,
      failed_list: failedList,
    },
  };
};
const deleteFeiShuGroupBot = async (chat_bot, logger) => {
  try {
    const result = await faas.function('GroupBotRevoke').invoke({ chat_bot: chat_bot });
  } catch (error) {
    logger.error('批量删除飞书群机器人失败->' + error);
  }
};
