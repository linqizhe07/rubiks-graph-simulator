# 魔方 · 图论模拟器

**把魔方画成一张图：54 个节点是贴纸，9 个圆环是层——每一次转动，都只是圆环上的一次置换。**

在线体验：**https://linqizhe07.github.io/rubiks-graph-simulator/**

![魔方图论模拟器截图：左边是三维魔方，右边是由 9 个圆环和 54 个节点组成的图，R' 正在转动](docs/screenshot.png)

灵感来自 X 上 [@UnicornBitcoin 分享的一段动画](https://x.com/UnicornBitcoin/status/2107652690113339684)（「数学不愧是科学之王，用图论揭示魔方的底层逻辑」）。这个项目把动画里的那张图做成了可以交互的模拟器，几何比例按原视频逐帧测量还原：模型算出的 54 个节点位置与视频中检测到的节点平均相差 0.47 像素（视频宽 2160 像素）。

## 这张图是怎么来的

| | |
|---|---|
| **圆环 = 层** | 魔方有 3 个转轴、每轴 3 层，共 9 个可转动的层。同一转轴的 3 层画成 3 个**同心圆**；三组同心圆的圆心构成一个等边三角形。 |
| **节点 = 贴纸** | 每张贴纸恰好属于两个层（与所在面平行的两个方向），所以画在这两个圆的**交点**上。两组同心圆 3×3 两两相交，交出两块 3×3 点阵——正好是一对相对的面。 |
| **面的位置** | R、U、F 位于各自那组同心圆的**圆心**（内三角），它们的对面 L、D、B 在外侧。最内圈正是圆心那个面所在的层，所以转 R 时，整个内圈连同圆心的 R 面一起像表盘一样转动。 |
| **转动 = 置换** | 转一层 = 这个圆上的 12 个节点沿圆走过「一个面」（3 个节点），其中 3 个节点会穿过圆上没有节点的那段空白弧；外层转动时，圆心处或对侧的那个面再原地转 90°。 |

几个可以在页面里验证的事实：

- 9 个圆 × 每圆 12 个节点 = 54 个节点 × 每点 2 个圆 = 108；
- 每个面在图上都是「从外面看」的方向：点击任意一个面的节点，它都按顺时针转；
- 魔方群就是这 9 个圆生成的置换群，共 43,252,003,274,489,856,000 个状态；
- `R U` 的阶是 105，`R U R' U'` 的阶是 6，T 置换是 5 个对换——在「公式实验室」里输入即可看到循环分解，并在图上画出每个贴纸的去向。

## 功能

- **图论视图**：9 个圆环、54 个节点，配色与几何取自原视频；转动时对应圆环加深，节点沿圆弧滑动并带拖尾，外层的面原地自转。
- **同步 3D 视图**：同一状态的三维魔方，转动与图同步；可拖动旋转视角，双击复位。悬停某个圆环时，3D 视图会描出对应的层。
- **交互**
  - 点击节点：转动它所在的面（顺时针），Shift / 右键逆时针；
  - 点击圆环：沿屏幕顺时针转动这一层；
  - 拖动节点：沿经过它的两个圆中与拖动方向更一致的那个转动；
  - 键盘：`U D L R F B` 外层、`M E S` 中层、`X Y Z` 整体转动，加 `Shift` 逆时针，`Ctrl/⌘+Z` 撤销、`Ctrl/⌘+Shift+Z` 重做。
- **打乱 / 还原 / 演示**：还原 = 按相反顺序撤回全部转动（相邻同名转动会先合并）；演示 = 像原视频那样先打乱再还原。
- **公式实验室**：支持 `R U' F2 M x Rw r`、括号重复 `(R U)6`、交换子 `[R, U]`、共轭 `[F: R U R' U']`；显示步数、阶数、循环分解，可一键「重复至复原」。

## 高帧率

- 所有动画都由 `requestAnimationFrame` 的时间戳驱动，与帧率无关：60Hz、120Hz、144Hz 屏幕都会跑满刷新率，掉帧也不会变慢。
- 背景和 9 个灰色圆环预渲染到离屏画布，每帧一次 `drawImage`；54 个节点按颜色预渲染成精灵图。
- 拖尾由动画参数解析计算（不依赖历史帧），每个运动节点一条渐变路径；颜色字符串全部预先缓存，渲染循环里几乎不分配内存。
- 3D 视图是无依赖的 Canvas 2D 软渲染：背面剔除 + 按转动轴分片的画家算法，转动过程中不会穿插。
- 空闲时不重绘；右上角实时显示 FPS 与每帧渲染耗时。在 120Hz 的浏览器里实测 120 FPS，两块画布每帧的 JS 开销通常在 1 毫秒以内。

## 本地运行

纯静态页面，没有任何依赖，也不需要构建。直接打开 `index.html` 即可，或者起一个静态服务器：

```bash
python3 -m http.server 8000
```

然后访问 http://localhost:8000 。

## 测试

魔方模型与图的几何都有单元测试（Node 18+，无需安装依赖）：

```bash
npm test
```

测试内容包括：每个圆恰好经过 12 个节点、每个节点恰好在 2 个圆上、动画路径的终点就是置换后的位置、经典公式的阶数（`R U` = 105、T 置换 = 2、超级翻转 = 2）、公式解析等。

## 项目结构

```
index.html            页面
css/style.css         样式
js/cube.js            魔方模型：54 个贴纸槽位，每步转动是一个置换；公式解析、阶数、循环分解
js/graph.js           图的几何：圆心、半径、节点 = 圆的交点；转动时每个节点的运动路径
js/graph-view.js      图论视图渲染（Canvas 2D）
js/cube3d-view.js     3D 魔方渲染（Canvas 2D 软渲染）
js/app.js             动画队列、交互、主循环
test/                 node:test 单元测试
```

---

## English

**Rubik's Cube as a graph.** The 54 stickers are vertices and the 9 layers are circles; every turn is just a permutation along one circle. Layers of the same axis are three concentric circles, and the three families are centred on the vertices of an equilateral triangle. Each sticker belongs to exactly two layers, so it sits at the intersection of those two circles. Turning a layer moves its 12 vertices one face (three vertices) along the circle, and an outer layer also spins the face at its centre. The geometry was measured frame by frame from the [original animation](https://x.com/UnicornBitcoin/status/2107652690113339684). The page also has a synchronised 3D view, click and drag controls, keyboard notation, scramble, solve, undo and redo, and an algorithm lab that shows each algorithm's order and cycle structure. It is a zero-dependency static site using Canvas 2D, and its time-based animation runs at the display's full refresh rate.

Run it by opening `index.html`, or serve the folder with any static server. Run the tests with `npm test`.

## License

[MIT](LICENSE)
