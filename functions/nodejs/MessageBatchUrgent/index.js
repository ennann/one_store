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
  logger.info(`批次加急消息 ${new Date()} 函数开始执行`, params);

  if (!params.batch_record) {
    throw new Error("缺少消息发送批次数据");
  }

  const { batch_record } = params;

  const DB = application.data.object;
  const OP = application.operator;
  const BATCH_OBJECT = "object_message_send";
  const RECORD_OBJECT = "object_message_record";
  const READ_OBJECT = "object_message_read_record";

  // 获取用户user_id数组
  const getUserIds = async (users) => {
    const userIds = [];
    await DB("_user")
      .where({ _id: OP.hasAnyOf(users.map(item => item._id)) })
      .select("_lark_user_id")
      .findStream(records => userIds.push(...records));
    return userIds.map(item => item._lark_user_id);
  };

  // 获取关联消息记录的群人员
  const getUnReadUsers = async (_id) => {
    const unreadRecords = [];
    await DB(READ_OBJECT)
      .where({
        message_send_record: { _id },
        read_status: "option_unread",
      })
      .select("_id", "accept_user")
      .findStream(records => unreadRecords.push(...records));
    return unreadRecords.map(item => item.accept_user);
  };

  // 获取加急数据
  const getUrgent = async (ele) => {
    if (ele.option_send_channel === "option_user") {
      userList = ele.accept_user;
    } else {
      userList = await getUnReadUsers(ele._id)
    }
    logger.info({ userList });
    const user_id_list = await getUserIds(userList);
    logger.info({ user_id_list });
    return {
      message_id: ele.message_id,
      urgent_type: "urgentApp",
      user_id_list
    };
  }

  // 生成加急列表
  // 获取批次关联的消息发送记录，且未读数量>0、阅读状态为未读/部分已读、发送成功
  const getUrgentList = async () => {
    const msgRecords = [];
    await DB(RECORD_OBJECT)
      .where({
        message_batch: { _id: batch_record._id },
        unread_count: OP.gte(0),
        result: "option_success",
        read_status: OP.in("option_unread", "option_partread")
      })
      .select("_id", "message_id", "option_send_channel", "message_chat", "accept_user")
      .findStream(records => msgRecords.push(...records));
    logger.info({ msgRecords });
    if (msgRecords.length > 0) {
      const urgentList = await Promise.all(msgRecords.map(ele => getUrgent(ele)));
      logger.info({ urgentList });
      return urgentList;
    }
    return [];
  };

  // 获取批次详情
  const getBatchData = async () => {
    const record = await DB(BATCH_OBJECT)
      .where({ _id: batch_record._id })
      .select("_id", "unread_count", "option_status")
      .findOne();
    logger.info({ record });
    return record;
  };

  try {
    const batchData = await getBatchData();
    if (batchData.unread_count === 0) {
      logger.info("消息批次未读消息为0，中断函数");
      return;
    }
    if (!["option_all_success", "option_part_success"].includes(batchData.option_status)) {
      logger.info("消息批次中没有发送成功的消息，中断函数");
      return;
    }
    const urgentList = await getUrgentList();
    if (urgentList.length === 0) {
      logger.info("消息批次中没有满足加急的消息记录");
      return;
    }
    const result = await Promise.all(urgentList.map(item => faas.function("MessageUrgent").invoke({ ...item })));
    const successRes = result.filter(i => i.code === 0);
    const failRes = result.filter(i => i.code === -1);
    logger.info(`批次加急消息记录总数：${result.length}，成功数量：${successRes.length}，失败数量：${failRes.length}`);
  } catch (error) {
    logger.error("批次加急消息出错", error);
    throw new Error("批次加急消息出错", error)
  }
}