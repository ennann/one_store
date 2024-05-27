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
  const { user_rule, user_department, work_team, job_position, publisher } = params;
  let userList = [];

  if (!user_rule && !work_team && !user_department && !job_position) {
    logger.error('错误：缺少人员筛选规则');
    return userList;
  }

  let ruleRecord = {};
  if (user_rule) {
    ruleRecord = await application.data
      .object('object_user_rule')
      .select(['_id', 'job_position', 'department', 'work_team'])
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
      logger.error(`${description}查询时发生错误：`, error);
      return userList;
    }
  };

  // 获取店长人员
  const getStoreMangers = async (query) => {
    const mamgers = [];
    await application.data.object("object_store")
      .where(query)
      .select("store_manager", "_id")
      .findStream(records => mamgers.push(...records));
    return mamgers.map(i => i.store_manager);
  };

  // 获取店员
  const getStoreClerks = async (query) => {
    const clerks = [];
    await application.data.object("object_store_staff")
      .where(query)
      .select("store_staff", "_id")
      .findStream(records => clerks.push(...records));
    return clerks.map(i => i.store_staff);
  };

  // 获取门店店长和门店成员
  const getMembers = async (roleRecord, job_position) => {
    let department;
    if (roleRecord.role !== "option_admin") {
      // 不为管理员
      const userRecord = await application.data.object("_user")
        .where({ _id: publisher._id || publisher.id, _department: application.operator.notEmpty() })
        .select("_id", "_department")
        .findOne();
      if (!userRecord._department) {
        return [];
      }
      department = userRecord._department;
    }
    // 岗位数据，目前只有店长和店员
    const jobRecords = await application.data.object("object_job_position")
      .where({
        _id: application.operator.hasAnyOf(job_position.map(item => item.id || item._id))
      })
      .select("job_code", "_id")
      .find();
    const funList = jobRecords.map(i => {
      if (i.job_code === "store_clerk") {
        return getStoreClerks(department ? { store_staff_department: { _id: department._id } } : {});
      } else {
        return getStoreMangers(department ? { store_department: { _id: department._id } } : {});
      }
    });
    const result = await Promise.all(funList);
    const ids = result.flat().map(i => i._id);
    const users = await getUserRecord({ _id: application.operator.hasAnyOf(ids) }, "所属岗位");
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
    const users = await getUserRecord({ _id: application.operator.hasAnyOf(teamUserList.map(item => item.user._id)) }, '所属用户组');
    userList.push(...users);
  }

  // 获取岗位下的人员
  if (ruleRecord.job_position && ruleRecord.job_position.length > 0) {
    let jobUsers = [];
    if (publisher) {
      // 获取权限
      const roleRecord = await application.data.object("object_permission")
        .where({ user: { _id: publisher._id || publisher.id }, status: true })
        .select("_id", "role")
        .findOne();
      if (roleRecord) {
        jobUsers = await getMembers(roleRecord, ruleRecord.job_position);
      } else {
        logger.warn("在权限授权明细表没有启用状态的发布人");
      }
    } else {
      logger.warn("缺少发布人参数");
      // throw new Error("缺少发布人参数");
    }
    userList.push(...jobUsers);
  }

  userList = userList.filter((item, index, self) => self.findIndex(t => item._lark_user_id && t._lark_user_id === item._lark_user_id) === index);

  if (userList.length === 0) {
    logger.error('通过人员筛选条件获取人员列表为空');
    return [];
  }

  return userList.map(item => ({
    ...item,
    user_id: item._lark_user_id
  }));
};
