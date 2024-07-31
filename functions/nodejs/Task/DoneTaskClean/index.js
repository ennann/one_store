// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const dayjs = require('dayjs');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  const DB = application.data.object;
  const STORE_TASK = "object_store_task"; // 门店普通任务
  const TASK = "object_task"; // 验收任务
  const TASK_DEF = "object_task_def_copy"; // 任务发布抄送人
  const labelObj = {
    [STORE_TASK]: "门店普通任务",
    [TASK]: "验收任务",
    [TASK_DEF]: "任务发布抄送人"
  }
  const clean_days = await application.globalVar.getVar("message_record_storage_days");

  // 获取多少天前的时间戳
  const getBeforeTimestamp = () => {
    const currentTime = dayjs();
    const daysAgo = currentTime.subtract(Number(clean_days), 'day');
    return daysAgo.valueOf();
  };

  const timestamp = getBeforeTimestamp();

  const cleanData = async (objectApiName) => {
    let query = { _createdAt: application.operator.lt(timestamp) };
    if ([STORE_TASK, TASK].includes(objectApiName)) {
      query = {
        ...query,
        task_status: "option_completed"
      }
    }
    try {
      const tasks = [];
      await DB(objectApiName)
        .where(query)
        .select("_id")
        .findStream(records => tasks.push(...records));
      if (tasks.length > 0) {
        await Promise.all(tasks.map(item => DB(objectApiName).delete(item)));
      } else {
        logger.warn(`${labelObj[objectApiName]}下不存在满足条件的数据`);
      }
    } catch (error) {
      throw new Error(`清理${labelObj[objectApiName]}记录失败`);
    }
  }

  try {
    await Promise.all([STORE_TASK, TASK, TASK_DEF].map(objKey => cleanData(objKey)));
  } catch (error) {
    logger.error("清理任务记录失败", error);
  }
}