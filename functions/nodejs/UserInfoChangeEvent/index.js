// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
const { fetchDepartmentInfoById } = require('../utils');
const { newLarkClient } = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 根据事件传送过来的信息，判断用户部门信息是否发生变化，并触发相应的操作

  // 在飞书，部门信息为必填项，所以用户的部门信息不可能为空
  const oldDepartmentList = params.event.event.old_object.department_ids;
  const newDepartmentList = params.event.event.object.department_ids;
  const { email, name, open_id, mobile } = params.event.event.object; // 变更的用户信息


  // 如果变更后的部门一致，则不做任何操作
  if (oldDepartmentList[0] === newDepartmentList[0]) {
    return { code: -1, message: '部门信息未发生变化' };
  }
  // 邮箱查询变更为手机号查询apaas用户
  // let userRecord = await application.data.object('_user').select('_id', '_name', '_email').where({ _email: email }).findOne();
  const userPhonePre = mobile.substring(3);
  let userRecord = await application.data.object('_user').select('_id', '_name', '_email').where({_phoneNumber: application.operator.contain(userPhonePre)}).findOne();

  if (!userRecord) {
    logger.error('用户信息不存在');
    return { code: -1, message: '用户信息在 aPaaS 不存在' };
  }

  const client = await newLarkClient({ userId: context.user._id }, logger);

  // 默认只获取第一个部门信息
  let oldDepartmentInfo = await fetchDepartmentInfoById(client, oldDepartmentList[0]);
  let newDepartmentInfo = await fetchDepartmentInfoById(client, newDepartmentList[0]);

  // 根据部门名称获取部门 aPaaS 记录
  let oldDepartmentRecord = await application.data.object('_department').select('_id', '_name').where({ _name: oldDepartmentInfo.name }).findOne();
  let newDepartmentRecord = await application.data.object('_department').select('_id', '_name').where({ _name: newDepartmentInfo.name }).findOne();

  // 飞书中存在的部门
  if( !newDepartmentRecord ){
    logger.error('新部门信息不存在');
    return { code: -1, message: '新部门信息在 aPaaS 不存在' };
  }

  // 找到新的部门的群聊(部门相同，群类型等于 option_business 经营群)
  let newDepartmentChatGroup = await application.data.object('object_feishu_chat').select('_id', 'chat_id', 'chat_link', 'chat_group_type').where({ department: newDepartmentRecord._id, chat_group_type: 'option_business' }).findOne();
  // let oldDepartmentChatGroup = await application.data.object('object_feishu_chat').select('_id', 'chat_id', 'chat_link', 'chat_group_type').where({ department: oldDepartmentRecord._id, chat_group_type: 'option_business' }).findOne();
  let oldDepartmentChatGroup = {};
  if(oldDepartmentList[0] != 0 && !oldDepartmentRecord){
    oldDepartmentChatGroup = await application.data.object('object_feishu_chat').select('_id', 'chat_id', 'chat_link', 'chat_group_type').where({ department: oldDepartmentRecord._id, chat_group_type: 'option_business' }).findOne();
  }

  // 创建群成员记录，将用户拉入群聊
  if (newDepartmentChatGroup) {
    await application.data.object('object_chat_member').create({
      store_chat: { _id: newDepartmentChatGroup._id },
      chat_member: { _id: userRecord._id },
      chat_member_role: 'option_group_member',
    });

    // 将用户拉入新的部门群聊
    let res = await client.im.chatMembers.create({
      path: { chat_id: newDepartmentChatGroup.chat_id },
      params: { member_id_type: 'open_id' },
      data: { id_list: [open_id] },
    });
  }

  // 将用户从旧的部门群聊中移除
  if (oldDepartmentChatGroup && oldDepartmentList[0] != 0) {
    let chatMemberRecord = await application.data.object('object_chat_member').select('_id').where({ store_chat: oldDepartmentChatGroup._id, chat_member: userRecord._id }).findOne();

    if (chatMemberRecord) {
      await application.data.object('object_chat_member').delete(chatMemberRecord._id);
    }

    // 将用户从旧的部门群聊中移除
    let res = await client.im.chatMembers.delete({
      path: { chat_id: oldDepartmentChatGroup.chat_id },
      params: { member_id_type: 'open_id' },
      data: { id_list: [open_id] },
    });
  }
};
