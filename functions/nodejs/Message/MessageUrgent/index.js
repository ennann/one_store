// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const { newLarkClient, createLimiter, chunkArray } = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  const urgentTypes = ["urgentApp", "urgentSms", "urgentPhone"];

  if (!params.urgent_type || !params.user_id_list || !params.message_id) {
    throw new Error("缺少参数");
  }

  if (!urgentTypes.includes(params.urgent_type)) {
    throw new Error("加急类型传参有误，urgentApp-应用加急，urgentSms-短信加急，urgentPhone-电话加急");
  }

  if (params.user_id_list.length === 0) {
    logger.error("消息发送人员列表为空，中断函数");
    return;
  }

  const client = await newLarkClient({ userId: context.user._id }, logger);
  const { urgent_type, user_id_list, message_id } = params;

  const urgentMessage = async (user_id_list) => {
    const fun = client.im.message[urgent_type];
    const label = urgent_type === "urgentApp"
      ? "应用加急"
      : urgent_type === "urgentSms"
        ? "短信加急"
        : "电话加急";
    try {
      const res = await fun({
        path: { message_id },
        data: { user_id_list },
        params: { user_id_type: "user_id" },
      });
      if (res.code !== 0) {
        logger.error(`发送${label}消息失败`, error);
      }
      return res;
    } catch (error) {
      logger.error(`发送${label}消息失败`, error);
      return { code: -1 };
    }
  };

  try {
    const urgentFun = createLimiter(urgentMessage);
    const user_chunk = chunkArray(user_id_list);
    const result = await Promise.all(user_chunk.map(list => urgentFun(list)));
    const { successRes, failRes } = result.reduce((pre, ele, index) => {
      if (ele.code === 0) {
        return {
          ...pre,
          successRes: [...pre.successRes, ...user_chunk[index]]
        }
      }
      if (ele.code !== 0) {
        return {
          ...pre,
          failRes: [...pre.failRes, ...user_chunk[index]]
        }
      }
      return pre;
    }, { successRes: [], failRes: [] });
    return { code: failRes.length === user_id_list.length ? -1 : 0 };
  } catch (error) {
    logger.error(`消息加急失败`, error);
    return { code: -1 };
  }
}
