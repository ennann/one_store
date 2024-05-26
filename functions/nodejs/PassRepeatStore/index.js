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
  
  // 获取新加入的成员列表
  const newGroupUserList = params.group1;
  // 获取已存在的成员列表
  const alreadyGroupUserList = params.group2;

  const chatId = params.groupId;
  const groupRes = await application.data
  .object('object_feishu_chat')
  .select("chat_owner","chat_managers")
  .where({chat_id: chatId}).findOne();

  let filteredData = groupRes.chat_managers.map(manager => manager.id);
  filteredData.push(groupRes.chat_owner?._id);

  // 获取已存在的群成员的id列表
  let alreadyGroupUserIds = alreadyGroupUserList.map(user => user.chat_member._id);

  // 过滤新加入的成员列表，只保留那些在已存在的id列表中没有出现过的成员
  let newUsers = newGroupUserList.filter(user => !alreadyGroupUserIds.includes(user.chat_member._id));

  newUsers = newUsers.filter(user => !filteredData.includes(user.chat_member.id));

  return {needAddGroup: newUsers}
}