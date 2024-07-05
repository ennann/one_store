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
    logger.info(`查找人员范围函数开始执行`, params);
  
    const { user_rule, work_team, user_department, job_position, publisher } = params;
    let userList = [];
  
    if (!user_rule && !work_team && !user_department && !job_position) {
        logger.error('传入参数错误：筛选人员时缺少人员筛选规则');
        return userList;
    }
  
    // 补全人员规则字段的数据
    let ruleRecord = {};
    if (user_rule) {
        ruleRecord = await application.data
            .object('object_user_rule')
            .select(['_id', 'job_position', 'department', 'work_team', 'department', 'job_position'])
            .where({ _id: user_rule._id || user_rule.id })
            .findOne();
    } else {
        if (work_team && work_team.length > 0) {
            ruleRecord = { ...ruleRecord, work_team };
        }
        if (user_department && user_department.length > 0) {
            ruleRecord = { ...ruleRecord, department: user_department };
        }
        if (job_position && job_position.length > 0) {
            ruleRecord = { ...ruleRecord, job_position };
        }
    }
    logger.info('筛选人员规则：', ruleRecord);
  
    // 原子函数：获取用户记录数据
    const getUserRecord = async (query, description) => {
        try {
            const userRecords = [];
            await application.data
                .object('_user')
                .select('_id', '_email', '_phoneNumber', '_lark_user_id')
                .where(query)
                .findStream(async records => {
                    userRecords.push(...records);
                });
            return userRecords;
        } catch (error) {
            logger.error(`${description}查询aPaaS用户表时发生错误：`, error);
            return userList;
        }
    };
  
    // 原子函数：获取店长人员
    const getStoreMangers = async query => {
        try {
            const manager = [];
            await application.data
                .object('object_store')
                .select('store_manager', '_id')
                .where(query)
                .findStream(records => manager.push(...records));
            return manager.map(i => i.store_manager);
        } catch (error) {
            logger.error('筛选人员时，获取店长人员发生错误：', error);
            return [];
        }
    };
  
    // 原子函数：获取店员人员
    const getStoreClerks = async query => {
        try {
            const clerks = [];
            await application.data
                .object('object_store_staff')
                .select('store_staff', '_id')
                .where(query)
                .findStream(records => clerks.push(...records));
            return clerks.map(i => i.store_staff);
        } catch (error) {
            logger.error('筛选人员时，获取店员人员发生错误：', error);
            return [];
        }
    };
  
    // 原子函数：获取其他职务人员
    const getOtherJobPosition = async query => {
        try {
            const otherJobPosition = [];
            await application.data
                .object('_user')
                .select('_id', '_lark_user_id')
                .where(query)
                .findStream(records => otherJobPosition.push(...records));
            return otherJobPosition;
        } catch (error) {
            logger.error('筛选人员时，获取其他职务人员发生错误：', error);
            return [];
        }
    };
  
    // 获取特定岗位下的所有人员
    const getJobPositionMembers = async (roleRecord, job_position) => {
        let department; // 发布人的部门
        if (roleRecord.role !== 'option_admin') {
            // 不为管理员
            const userRecord = await application.data
                .object('_user')
                .select('_id', '_department', '_lark_user_id')
                .where({ _id: publisher._id || publisher.id, _department: application.operator.notEmpty() })
                .findOne();
            if (!userRecord._department) {
                return [];
            }
            department = userRecord._department;
        }
  
        // 原子函数：根据岗位记录ID查找岗位数据
        const jobPositionRecords = await application.data
            .object('object_job_position')
            .select('job_code', '_id', 'source', 'job_name')
            .where({
                _id: application.operator.hasAnyOf(job_position.map(item => item.id || item._id)),
            })
            .find();
        logger.info('【日志检查】获取到的岗位记录：', jobPositionRecords);
  
        const result = [];
  
        for (const position of jobPositionRecords) {
            let res;
            // logger.info('for循环内的当前岗位信息：', position);
            // 1. 如果岗位信息是手动维护的，就根据店长或者店员找到对应的人员
            if (position.source === 'option_manual') {
                // logger.info('该岗位信息是手动维护的', position);
                if (position.job_code === 'store_clerk') {
                    res = await getStoreClerks(department ? { store_staff_department: { _id: department._id } } : {});
                } else {
                    res = await getStoreMangers(department ? { store_department: { _id: department._id } } : {});
                }
            } else if (position.source === 'option_feishu') {
                // 2. 如果岗位信息是从飞书同步的，就在用户表里找到对应的人员
                // logger.info('该岗位信息是从飞书自动同步的', position);
                res = await getOtherJobPosition({ _jobTitle: position.job_name });
            } else {
                res = []; // 添加默认返回值，确保返回的是一个数组
            }
            logger.info(`【${position.job_name}岗位检查】获取到的岗位下的人员：`, res);
            result.push(...res);
        }
  
        // 对 result 内元素的 _id 进行整理，放在 apaasUserRecordIds 内
        const apaasUserRecordIds = result.map(item => item._id);
        logger.info('【日志检查】获取到的岗位下的人员ID：', apaasUserRecordIds);
        if (apaasUserRecordIds.length === 0) {
            logger.warn('获取到的岗位下的人员为空');
            return [];
        }
        const users = await getUserRecord({ _id: application.operator.hasAnyOf(apaasUserRecordIds) }, '所属岗位');
        return users;
    };
  
    // 获取部门多层级下的人员
    const getDepartmentUser = async ids => {
        const list = [];
        const users = await getUserRecord({ _department: { _id: application.operator.hasAnyOf(ids) } }, '所属部门');
        list.push(...users);
        // 获取以当前部门为上级部门的子部门
        const childDepartment = await application.data
            .object('_department')
            .select('_id')
            .where({ _superior: { _id: application.operator.hasAnyOf(ids) } })
            .find();
        if (childDepartment.length > 0) {
            const childDepartmentUsers = await getDepartmentUser(childDepartment.map(item => item._id));
            list.push(...childDepartmentUsers);
        }
        return list;
    };
  
    // 获取所属部门下的人员
    if (ruleRecord.department && ruleRecord.department.length > 0) {
        const departmentIds = ruleRecord.department.map(item => item._id || item.id);
        const users = await getDepartmentUser(departmentIds);
        userList.push(...users);
    }
  
    // 获取所属用户组下的人员
    if (ruleRecord.work_team && ruleRecord.work_team.length > 0) {
        const teamIds = ruleRecord.work_team.map(item => item._id || item.id);
        const teamUserList = await application.data
            .object('object_user_group_member')
            .select('user')
            .where({
                user_group: {
                    _id: application.operator.hasAnyOf(teamIds),
                },
            })
            .find();
        logger.info('获取到的用户组下的人员：', teamUserList);
        if (teamUserList.length === 0) {
            logger.warn('获取到的用户组下的人员为空');
        } else {
            const users = await getUserRecord({ _id: application.operator.hasAnyOf(teamUserList.map(item => item.user._id)) }, '所属用户组');
            userList.push(...users);
        }
    }
  
    // 获取岗位下的人员
    if (ruleRecord.job_position && ruleRecord.job_position.length > 0) {
        let jobUsers = [];
        if (publisher) {
            // 获取权限
            const roleRecord = await application.data
                .object('object_permission')
                .select('_id', 'role')
                .where({ user: { _id: publisher._id || publisher.id }, status: true })
                .findOne();
            logger.info('【权限检查】发布人权限记录：', roleRecord);
            if (roleRecord) {
                jobUsers = await getJobPositionMembers(roleRecord, ruleRecord.job_position);
            } else {
                logger.warn('在权限授权明细表没有启用状态的发布人');
            }
        } else {
            logger.warn('缺少发布人参数');
        }
        userList.push(...jobUsers);
    }
  
    userList = userList.filter((item, index, self) => self.findIndex(t => item._lark_user_id && t._lark_user_id === item._lark_user_id) === index);
  
    if (userList.length === 0) {
        logger.error('通过人员筛选条件获取人员列表为空');
        return [];
    }
    logger.info('查找人员范围函数执行结束，总共找到人员：', userList.length);
  
    return userList.map(item => ({
        ...item,
        user_id: item._lark_user_id,
    }));
  };
  