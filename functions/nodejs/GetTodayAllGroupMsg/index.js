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
  // logger.info(`${new Date()} 函数开始执行`);
  // 当天最大全部群发送数
  const MAX_ALL_MSG_NUM = 5;

  // 获取当前的日期 2024-05-21
  const today = getCurrentDate();
  logger.info("当前日期：", today);

   // 获取redis中当天发送全部群的消息数 
   const msgCount = await baas.redis.get(today)

  // 获取操作类型  1-校验是否超过最大数 2-更新当天最大记录数
  const operateFlag = params.operateFlag;
  if (operateFlag === 1) {
      if (msgCount >= MAX_ALL_MSG_NUM) {
          return false;
      } else {
          return true;
      }
  } else if (operateFlag === 2) {
      if(msgCount){
        await baas.redis.setex(today,24*60*60,msgCount+1);
      }else{
        await baas.redis.setex(today,24*60*60,1);
      }
      return true
  }else {
    return false;
  }
}

// 获取当天的时间，并以 ’2024-05-21‘格式返回
function getCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}