// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");

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
    // 日志功能
    logger.info(`用户离职，函数开始执行`);
    // 在飞书，部门信息为必填项，所以用户的部门信息不可能为空
    const oldDepartmentList = params.event.event.old_object.department_ids;
    const { name, open_id, user_id } = params.event.event.object;

    //查询apaas用户
    const userRecord = await application.data.object('_user').select('_id', '_name', '_email').where({ _lark_user_id: user_id }).findOne();

    if (!userRecord) {
        logger.error('用户信息不存在');
        return { code: -1, message: `用户 ${name} ${user_id} 的信息在 aPaaS 不存在` };
    }

    const client = await newLarkClient({ userId: context.user._id }, logger);

    // 默认只获取第一个部门信息
    let oldDepartmentOpenId = oldDepartmentList[0];
    logger.info(`用户离职，用户原部门信息：${oldDepartmentOpenId}`)
    // 获取部门信息
    const oldDepartmentInfo = await fetchDepartmentInfoById(client, oldDepartmentOpenId);

    // 根据部门名称获取部门 aPaaS 记录
    let oldDepartmentRecord = await application.data.object('_department').select('_id', '_name').where({ _name: oldDepartmentInfo.name }).findOne();

    if (oldDepartmentRecord) {
        logger.info('在 aPaaS 中找到旧部门信息为', oldDepartmentRecord);

        const oldDepartmentChatGroup = await application.data
            .object('object_feishu_chat')
            .select('_id', 'chat_id', 'chat_link', 'chat_group_type')
            .where({ department: oldDepartmentRecord._id, chat_group_type: 'option_business' })
            .findOne();

        // 将用户从旧的部门群聊中移除（飞书群成员 apaas）
        if (oldDepartmentChatGroup) {
            // 删除该用户在该部门下所在的门店成员信息

            // 1.获取老部门的id
            const oldDepId = oldDepartmentRecord._id;
            // 2.获取该部门下的所有门店信息 正常情况一个部门对应一个门店

            // 2.1获取门店信息
            const oldDepStore = await application.data
                .object('object_store')
                .select('_id')
                .where({ store_department: oldDepId })
                .findOne();

            // 2.2获取所有的门店成员信息
            const oldDepAllStoreStaff = await application.data
                .object('object_store_staff')
                .select('_id', 'store_staff_department', 'store_staff')
                .where({
                    store_staff: userRecord._id,
                    store: oldDepStore._id,
                }).find();

            // 3.删除该部门下的该员工的所有门店成员信息
            let idArray = oldDepAllStoreStaff.map(item => item._id); // 提取每个对象的 _id 属性值，生成新的数组

            if (idArray.length > 0) {
                await application.data.object('object_store_staff').batchDelete(idArray);
                logger.info('删除该部门下的该员工的所有门店成员信息成功');
            } else {
                logger.error('未找到该员工在该部门下的门店成员信息');
            }

            let chatMemberRecord = await application.data
                .object('object_chat_member')
                .select('_id')
                .where({ store_chat: oldDepartmentChatGroup._id, chat_member: userRecord._id })
                .findOne();

            if (chatMemberRecord) {
                await application.data.object('object_chat_member').delete(chatMemberRecord._id);
            }

            try {
                // 将用户从旧的部门群聊中移除（飞书群成员 飞书平台）
                let res = await client.im.chatMembers.delete({
                    path: { chat_id: oldDepartmentChatGroup.chat_id },
                    params: { member_id_type: 'open_id' },
                    data: { id_list: [open_id] },
                });
                if (res.code !== 0) {
                    logger.error('将用户从旧的部门群聊中移除失败', res);
                }
            } catch (error) {
                logger.error('将用户从旧的部门群聊中移除失败', error);
            }
        }
    } else {
        logger.error('在 aPaaS 中未找到旧部门信息', oldDepartmentInfo);
    }
};
