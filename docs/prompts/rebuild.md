## 总体需求
我需要实现一个[pi package](https://pi.dev/docs/latest/packages)，包含一个 [pi extension](https://pi.dev/docs/latest/extensions) 和 一组 [skills](./skills/)

## Extension 描述

### 1. 一个基于飞书的会话机器人

用户可以通过在飞书中与机器人对话，可以实现与当前 Pi 交互终端对话，包括不限于：

- 用户通过飞书机器人给 Pi 发送消息, 消息中可以包含图片，文件等
- 用户通过飞书机器人接收 Pi 的回复，采用流式回复形式，且能正确渲染 Pi 的回复消息(例如markdown)
- 用户通过飞书机器人对 Pi 做一些简单管理，例如 Pi session管理/ Pi model切换。这些管理操作对话最好是card消息
- 用户与飞书机器人的对话，同步反映在 Pi 交互终端的对话上，反之用户如果直接在 Pi交互终端上进行对话，也会同步到飞书机器人对话中。

可以基于 [Feishu Channel SDK](https://github.com/larksuite/node-sdk/blob/feature/channel/docs/channel.zh.md) 实现飞书机器人通信

### 2. 一套 Pi 命令，可以管理飞书机器人通信

用户在 Pi 交互终端中通过以下命令实现 飞书机器人通信 管理
 
- `/feishu-im start`: 开始通信
- `/feishu-im stop`: 停止通信
- `/feishu-im restart`: 重启通信
- `/feishu-im status`: 查看通信状态 (包括pid，工作目录等)

飞书机器人通信是(用户scope)全局唯一的
