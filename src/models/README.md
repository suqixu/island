# 程序化模型

项目没有外部 GLB、GLTF 或 OBJ 模型文件。此目录保存场景模型生成器：

- `island.js`、`island-paths.js`：海岛、码头、植被和石阶。
- `island-cave.js`、`cave-vegetation.js`、`cave-flower-meadow.js`：山洞、洞口蕨草和花丛。
- `lighthouse.js`、`path-lamps.js`、`rest-pavilion.js`：灯塔、路灯和观景亭。
- `sailboats.js`、`marine.js`、`fish-wave.js`、`lagoon-life.js`：帆船、鲸豚、近岸鱼群、偶发鱼群跃浪与泻湖动物。

共享地形、布局、运动和材质工具位于 `src/`；贴图位于 `src/assets/textures/`。修改生成算法时保留同步与分段初始化的几何一致性，以及资源释放接口。

远海帆船在正常场景中使用颜色、光照与粗糙度，不派生帆布和木材的颜色、凹凸贴图。`loadSurfaces()` 仅供近景材质验收页显式调用；同一源图仍供码头木材使用，不能删除。
