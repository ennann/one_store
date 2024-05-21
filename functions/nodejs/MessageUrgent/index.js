// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const { newLarkClient, createLimiter } = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 日志功能
  logger.info(`消息加急 ${new Date()} 函数开始执行`, params);

  const urgentTypes = ["urgentApp", "urgentSms", "urgentPhone"];

  if (!params.urgent_type || !params.message_send_log_list) {
    throw new Error("缺少参数");
  }

  if (!urgentTypes.includes(params.urgent_type)) {
    throw new Error("加急类型传参有误，urgentApp-应用加急，urgentSms-短信加急，urgentPhone-电话加急");
  }

  if (params.message_send_log_list.length === 0) {
    logger.info("消息发送日志列表为空，中断函数");
    return;
  }

  const client = await newLarkClient({ userId: context.user._id }, logger);
  const { urgent_type, message_send_log_list } = params;

  const urgentMessage = async ({ message_id, receive_id_type, receive_id }) => {
    const user_id_list = [];
    if (receive_id_type === "user_id") {
      user_id_list.push(receive_id);
    }
    if(receive_id_type = "chat_id"){
      
    }
    const fun = client.im.message[urgent_type];
    const label = urgent_type === "urgentApp"
      ? "应用加急"
      : urgent_type === "urgentSms"
        ? "短信加急"
        : "电话加急";
    try {
      const res = await fun({
        path: { message_id },
        params: { user_id_type: "user_id" },
        data: { user_id_list }
      });
      logger.info({ res });
      if (res.code !== 0) {
        logger.error(`发送${label}消息失败`, error);
      }
      return res;
    } catch (error) {
      logger.info(`发送${label}消息失败`, error);
      throw new Error(`发送${label}消息失败`, error);
    }
  };

  try {
    const urgentFun = createLimiter(urgentMessage);
    const result = await Promise.all(message_send_log_list.map(item => urgentFun(item)));
    const
  } catch (error) {
    logger.info(`消息加急失败`, error);
    throw new Error(`消息加急失败`, error);
  }
}