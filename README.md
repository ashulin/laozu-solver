# laozu-solver-next

《我要当老祖》法宝背包摆盘优化器（重写版）。纯前端，部署在 GitHub Pages，数据只存在浏览器本地。

- 计算内核：沿用 [Eleven-tz/laozu-solver-juexing](https://github.com/Eleven-tz/laozu-solver-juexing)（觉醒版）的退火求解与觉醒计分，并修正为「每份红装独立觉醒」
- 交互设计：参考 [fradwow/laozu-solver](https://github.com/fradwow/laozu-solver)（原版）的实时摆盘、四视图与全自动截图识别
- 新增：账号级长老管理（默认账号默认拥有全部长老；拥有/星级/觉醒；按品级/元素/形态筛选）、法宝目录多维筛选（元素/形态/占格数/品阶）

法宝数据库、形状库、颜色签名与退火算法来自原版作者 fradwow；觉醒数据来自觉醒版作者 Eleven-tz。感谢两位作者。

设计文档：[docs/architecture.md](docs/architecture.md)

## 开发

需要 Node.js 22+。

```bash
npm install
npm run dev        # 本地开发
npm test           # 单元测试（vitest）
npm run build      # 类型检查 + 生产构建，产物在 dist/
npm run preview    # 预览构建产物
```

### 截图识别的测试截图（Git LFS）

`tests/fixtures/ocr/` 下的截图用 Git LFS 管理，克隆前先安装 Git LFS：

```bash
git lfs install    # 每台机器执行一次
git lfs pull       # 已经克隆过、但截图是指针文本时执行
```

没装 Git LFS 时截图是一小段指针文本，截图相关的测试会自动跳过，其它测试照常运行。

新增截图直接放进该目录并提交即可，`.gitattributes` 会自动按 LFS 处理。

**推送注意**：如果你的 git 配置了全局钩子目录（`core.hooksPath`），LFS 的推送钩子可能没有安装，推送时要先上传截图：

```bash
git lfs push --all origin
git push
```

## 游戏数据更新

数据从觉醒版源码中提取，产物在 `src/core/data/raw/`：

```bash
npm run extract-data -- /path/to/laozu-solver-juexing/index.html
```

更新后同步修改 `src/core/data/version.ts`。

## 部署

推送到 `main` 后，GitHub Actions 会跑测试、构建并发布到 GitHub Pages。首次使用需在仓库 Settings → Pages 中把 Source 设为 GitHub Actions。

## 目录

```
src/core/       纯领域层（数据、求解、识别），无框架依赖，可在 Node 下单测
src/workers/    Web Worker（求解、网格定位）
src/services/   主线程对 Worker 的封装、本地存储
src/stores/     Pinia 状态
src/components/ src/views/  界面
tests/          vitest 单测
scripts/        数据提取脚本
```
