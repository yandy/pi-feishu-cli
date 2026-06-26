# 发布新版本

发布通过 GitHub Actions 自动完成，触发条件是创建 GitHub Release。

## 操作步骤

```bash
# 在仓库根目录执行：

# 1. 确保全部通过
npm run typecheck && npm run check && npm test

# 2. 升级版本号并打 tag
npm version <新版本号>

# 3. 推送
git push origin main --tags

# 4. 创建 GitHub Release（触发发布）
gh release create v<新版本号> --title "v<新版本号>" --notes ""
```

创建 Release 后，`.github/workflows/publish.yml` 响应 `release: published` 事件，执行 `npm ci` + `npm publish --provenance`（OIDC 认证，无需本地 npm token）。

发布到：`pi-feishu-cli@X.Y.Z`（public access）
