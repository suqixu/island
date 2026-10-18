# 程序化模型

项目没有外部 GLB、GLTF 或 OBJ 模型文件。此目录保存场景模型生成器：

- `island.js`、`island-paths.js`：海岛、码头、植被和石阶。
- `island-cave.js`、`cave-vegetation.js`、`cave-flower-meadow.js`：山洞、洞口蕨草和花丛。
- `lighthouse.js`、`path-lamps.js`、`rest-pavilion.js`：灯塔、路灯和观景亭。
- `sailboats.js`、`marine.js`、`fish-wave.js`、`lagoon-life.js`：帆船、鲸豚、近岸鱼群、偶发鱼群跃浪与泻湖动物。
- `butterfly.js`：花丛蝴蝶的身体、触角、足与双翼，以三个实例批次绘制；行为位于 `src/flower-butterflies.js`，落花位置由 `src/flower-anchors.js` 跟随真实花朵与风摆采样。
- `meadow-insects.js`：蜜蜂的条纹腹部、触角与双翼，以及蜻蜓的复眼、分节细尾和四翼；每种三个实例批次，采蜜换花与短暂停悬的行为位于 `src/meadow-insects.js`，与蝴蝶共享天气判定和花朵占用记录。
- `woodland-animals.js`：小型林鸟的身体、足、双翼，以及松鼠的身体、独立四爪和蓬尾；行为位于 `src/woodland-wildlife.js`，`src/woodland-habitats.js` 从真实树枝、树干、亭栏和山径采样落脚点。
- `night-insects.js`：单批萤火虫光点和三个实例批次的飞蛾，不逐只添加灯光；行为位于 `src/night-wildlife.js`，读取真实林缘地表与亭灯位置。

共享地形、布局、运动和材质工具位于 `src/`；贴图位于 `src/assets/textures/`。修改生成算法时保留同步与分段初始化的几何一致性，以及资源释放接口。

远海帆船在正常场景中使用颜色、光照与粗糙度，不派生帆布和木材的颜色、凹凸贴图。`loadSurfaces()` 仅供近景材质验收页显式调用；同一源图仍供码头木材使用，不能删除。
