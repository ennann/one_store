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
//   const redisValue = await baas.redis.setex("2024-05-22",24*60*60,0);

//  const flag =  await baas.redis.get("2024-05-22")
//  logger.info("测试数据：",flag)

const apaas_dep_records = [];



// 获取所有部门信息
  await application.data
  .object("_department")
  .select(["_id","_name","_superior"])
  // .where({_superior: application.operator.contain(1799627808659514) })
  .findStream(records => {
    apaas_dep_records.push(...records);
    });

let isLeafNode = true;
for (const dep of apaas_dep_records) {
  if(dep._superior && "1799627902131225" == dep._superior._id){
    isLeafNode = false;
  }
}


  logger.info(isLeafNode);



  return

const feishu_pins = await application.data.object('object_chat_pin').select('pin_name', 'pin_url', 'chat_rule', '_id','all_chats').find();
logger.info("测试数据：",feishu_pins)

const feishu_chat_menu_catalogs = await application.data.object('object_chat_menu_catalog').select('name', 'description', 'chat_rule', '_id').where({
  'all_chats': "option_yes"
}).find();
logger.info("测试数据：",feishu_chat_menu_catalogs)
 return 
  // 在这里补充业务代码
}

async function isLeafNodeDep(targetId,list){


}