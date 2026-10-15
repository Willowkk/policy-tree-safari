# 国策树 · Policy Tree

免登录、数据保存在当前浏览器的个人国策树 PWA。支持 iPhone Safari 添加到主屏幕、离线使用和 JSON 备份。

[中文使用说明](README_CN.md) · [English guide](README_EN.md)

国策和复盘内容不上传至服务器。每位访问者使用自己的本地数据；手机和电脑不自动同步。请定期导出备份。

## 开发

```sh
npm ci
npm run dev
npm test
npm run build
```

GitHub Pages 通过 Actions 自动发布。项目子路径由构建环境变量 `POLICY_TREE_BASE` 指定；默认 `/`，本仓库使用 `/policy-tree-safari/`。

免费托管不代表所有中国大陆网络均可访问，需要由实际使用者测试。
