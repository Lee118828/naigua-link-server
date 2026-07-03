# 云端房间服务探针

这是一个零依赖 Node WebSocket 服务，适合先部署到抖音云托管或任意支持 Node 的云服务器，验证 2-4 人联机链路。

## 启动

```bash
npm start
```

默认端口：

```text
8080
```

也可以由平台注入：

```bash
PORT=8080 npm start
```

## 接口

HTTP 健康检查：

```text
GET /health
```

WebSocket：

```text
/ws
```

客户端发送：

```json
{ "type": "join", "room": "1234", "name": "黄色奶蛙" }
```

```json
{ "type": "move", "x": 456, "y": 234, "seq": 1 }
```

服务端广播：

```json
{
  "type": "state",
  "room": "1234",
  "players": [
    { "id": "abcd1234", "slot": 0, "name": "黄色奶蛙", "x": 456, "y": 234 }
  ]
}
```
