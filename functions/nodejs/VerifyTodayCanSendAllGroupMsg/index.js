// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const dayjs = require('dayjs');
const _ = application.operator;
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {

  // ===========================================
    // 暂时关闭数量校验 2024年05月29日 星期三


  // const currentTime = dayjs().valueOf(); // 当前时间
  // const startOfDay = dayjs(currentTime).startOf('day').subtract(8, 'hour').valueOf(); // 获取当天的开始时间
  // const endOfDay = dayjs(currentTime).endOf('day').subtract(8, 'hour').valueOf(); // 获取当天的结束时间

  // const messageDefineFields = await application.metadata.object("object_chat_message_def").getFields();
  // const fieldApiNames = messageDefineFields.map(item => item.apiName);

  // // 获取当前创建的 一次性 全部群的信息
  // const oneTodayMsgList = [];

  // await application.data.object('object_chat_message_def')
  //   .select(fieldApiNames)
  //   .where(
  //     _.or(
  //       _.and({
  //         option_status: 'option_enable',
  //         option_method: 'option_once',
  //         all_chats: 'option_yes',
  //         datetime_publish: _.lte(endOfDay),
  //         datetime_publish: _.gte(startOfDay)

  //       }), // 当天一次性的信息 全部群
  //       _.and({
  //         option_status: 'option_enable',
  //         option_method: 'option_cycle',
  //         option_time_cycle: 'option_day',
  //         all_chats: 'option_yes',
  //         datetime_start: _.lte(currentTime),
  //         datetime_end: _.gte(currentTime)
  //       }) //周期内的全部群信息 
  //     )
  //   )
  //   .findStream(item => {
  //     oneTodayMsgList.push(...item);
  //   })

  // if (oneTodayMsgList.length >= 5) {
  //   return { outFlag: false };
  // }
  return { outFlag: true };
}