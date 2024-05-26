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
  const { deploy_rule, specific_chat, department, chat_tag, all_chats } = params;

  // 定义返回数组
  let finalChatList = [];
  let deployRuleRecord = {};

  if (!deploy_rule && !specific_chat && !department && !chat_tag && !all_chats) {
    logger.error('错误：缺少分配规则');
    return finalChatList;
  }

  // 如果有规则，只从规则里获取规则详情
  if (deploy_rule) {
    deployRuleRecord = await application.data
      .object('object_deploy_rule')
      .select(['_id', 'all_chats', 'department', 'chat_tag', 'specific_chat', 'exclude_chat'])
      .where({ _id: deploy_rule._id || deploy_rule.id })
      .findOne();
  } else {
    // 没有传入规则，组合其他的子规则
    deployRuleRecord = { specific_chat, department, chat_tag, all_chats }
  }

  // 定义
  const fetchChatRecords = async (query, description) => {
    try {
      const chatRecords = [];
      await application.data
        .object('object_feishu_chat')
        .select(['chat_id'])
        .where(query)
        .findStream(async records => {
          // 仅仅 push (item => ({ _id: item._id, chat_id: item.chat_id })) 属性
          chatRecords.push(...records.map(item => ({ _id: item._id, chat_id: item.chat_id })));
        });
      return chatRecords
    } catch (error) {
      logger.error(`${description}查询时发生错误：`, error);
      return finalChatList;
    }
  };

  // 获取全部群
  if (deployRuleRecord.all_chats && deployRuleRecord.all_chats === 'option_yes') {
    let all_chats = await fetchChatRecords({ chat_id: application.operator.notEmpty(), chat_status: "option_02" }, '全部');
    finalChatList.push(...all_chats);
  }

  // 获取部门下的群
  if (deployRuleRecord.department && deployRuleRecord.department.length > 0) {
    let department_ids = deployRuleRecord.department.map(item => item._id || item.id);
    let department_chats = await fetchChatRecords({ department: application.operator.hasAnyOf(department_ids), chat_status: "option_02" }, '部门');
    finalChatList.push(...department_chats);
  }

  // 获取标签下的群
  if (deployRuleRecord.chat_tag && deployRuleRecord.chat_tag.length > 0) {
    let chat_tag_record_ids = deployRuleRecord.chat_tag.map(item => item._id || item.id);
    let chat_tag_chats = await fetchChatRecords({ chat_tag: application.operator.hasAnyOf(chat_tag_record_ids), chat_status: "option_02" }, '群标签');
    finalChatList.push(...chat_tag_chats);
  }

  // 获取指定群
  if (deployRuleRecord.specific_chat && deployRuleRecord.specific_chat.length > 0) {
    let specific_chat_ids = deployRuleRecord.specific_chat.map(item => item._id || item.id);
    let specific_chats = await fetchChatRecords({ _id: application.operator.in(specific_chat_ids) }, '指定群聊');
    finalChatList.push(...specific_chats);
  }

  // 对 finalChatList 去重，逻辑是 chat_id 唯一
  finalChatList = finalChatList.filter((item, index, self) => self.findIndex(t => item.chat_id && t.chat_id === item.chat_id) === index);

  // 获取需要排除的群
  if (deployRuleRecord.exclude_chat && deployRuleRecord.exclude_chat.length > 0) {
    let exclude_chat_ids = deployRuleRecord.exclude_chat.map(item => item._id || item.id);
    let exclude_chats = await fetchChatRecords({ _id: application.operator.in(exclude_chat_ids), chat_status: "option_02" }, '排除的群聊');
    finalChatList = finalChatList.filter(item => !exclude_chats.some(exclude => exclude._id === item._id));
  }

  return finalChatList;
};
