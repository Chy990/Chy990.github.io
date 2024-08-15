---
title: "Take off Distance"
collection: unicourse
permalink: /unicourse/takeoff
excerpt: 'Finished'
date: 2024-08-15
venue: 'Semester 2'
author_profile: false
toc: true
# slidesurl: 'http://academicpages.github.io/files/slides1.pdf'
# paperurl: 'http://academicpages.github.io/files/paper1.pdf'
# citation: 'Chen. (2024). 2703.'
---

# Question 

Calculate the take-off distance for a generic transport aircraft with the following properties:

- MTOW=55000kg
- Aspect ratio=9
- Planform area=95\\(m^2\\)
- 2 turbofan engines with maximum take-off thrust of 70000N each and maximum continuous thrust of 63000N
- In take-off configuration \\(C_{L_{max}}\\)=2.4 & \\(C_{D_0}\\)=0.0343

The aircraft is taking off from a dry asphalt runway at an altitude of 2000ft. Calculate the total take-off distance for this aircraft.

这是个非常抽象的题目，所以在此记录一下。你可能无法想象在这道题里边，你有许多不知道的数字其实是常数，诶因为你不知道我也不知道所以它被认定为常数！！可以耗费你一个小时去想都做不出来的抽象题目。为了防止全过程遗忘，在这里搭配诸位做题时的心里想法来解答。

### Step 1: Ambient condition

首先要知道一些基本条件。该跑到在**2000ft**海拔。所以你要考虑相比于sea-level不同的温度和大气压强。还要同时注意换算成国际制单位不要用人才制(imperial)单位。

Sea-level condition:

- 288.15\\(K\\)
- 1.225\\(kg/m^3\\)

$$
h=2000ft=2000\times 0.3048m=609.6m
$$

$$
T=T_0+Lh=288.15-0.0065\times 609.6=284.19K\ \ \ \ \ \ \ \ \text{from: 1-p32}
$$

$$
\rho=\rho_0\cdot(\frac{T}{T_0})^{-(\frac{g}{LR}+1)}=1.225\cdot(\frac{284.19}{288.15})^{-\frac{9.81}{-0.0065\cdot 287}+1}=1.155kg/m^3\ \ \ \ \ \ \ \ \text{from: 1-p32}
$$

这一步计算出了2000ft的高度对应的温度和密度：

- T=284.19K
  
- \\(\rho\\)=1.155\\(kg/m^3\\)

### Step 2: Calculate \\(V_{stall}\\)

$$
V_{stall}=\sqrt{\frac{W}{0.5\rho\cdot S\cdot C_{L_{max}}}}=\sqrt{\frac{55000\times 9.81}{0.5\times 1.155\times 95\times 2.4}}=64.01m/s\ \ \ \ \ \ \ \ \text{from: 2-p21}
$$

$$
V_R\text{: Rotation speed: 必须大于 }1.1V_S
$$

$$
V_R=1.1\times V_{stall}=1.1\times 64.01=70.41m/s\ \ \ \ \ \ \ \ \text{from: 4-p10}
$$

### Step 3: Base drag

这里还得看我们大哥Anderson他可真牛，整出来这这么个公式：

$$
\Delta C_{D_{LG}}=\frac{W}{S}K_{uc}m^{-0.215}\ \ \ \ \ \ \ \ \text{from: 4-p14}
$$

这里要注意\\(K_{uc}\\)这个玩意你不知道是啥，那就对了，因为题目屁都没给你能真知道就见鬼了。但是从pdf可以知道：

$$
K_{uc}=5.81\times 10^{-5}\text{ for zero flap and }K_{uc}=3.16\times 10^{-5}\text{ for max flap}
$$

身为aero学生我们都知道，飞机起飞的时候是不会空襟翼也不会满襟翼，所以其实我们还是不知道一个精确值。那这时候你就要学会去严谨的推理： Airbus的四档襟翼其实一般起飞时会挂在1或2，然后Boeing的满襟翼30度一般会被挂在10~15度，所以你可以大胆的取一个K的中间值了。因为K就只能在这个范围内波动。

$$
\text{So }K_{uc}=\frac{5.81+3.16}{2}\times 10^{-5}=4.485\times 10^{-5}
$$

$$
\Delta C_{D_{LG}}=\frac{55000\times 9.81}{95}\cdot 4.485\times 10^{-5}\cdot 55000^{-0.215}=0.0244
$$

$$
C_{D_0(T/O)}=C_{D_0}+\Delta C_{D_{LG}}=0.0343+0.0244=0.0587
$$

### Step 4:  Calculate take-off \\(C_D\\)

$$
C_{D(T/O)}=C_{D_0(T/O)}+KC_L^2
$$

算K先：(e不知道你就用0.7，不用就是你的错)

$$
K=\frac{1}{\pi AR e}=\frac{1}{\pi\cdot 9\cdot 0.7}=0.0505
$$

$$
C_{D(T/O)}=0.0587+0.0505\times 0.1^2=0.0592\ \ \ \ \ \ \ \ \text{from: 4-p16(}C_L\text{ estimated)}
$$

### Step 5: Calculate thrust

$$
T=T_0\cdot(\frac{\rho}{\rho_0})^n=2\times 70000\times(\frac{1.155}{1.225})^{0.7}=134.35kN\ \ \ \ \ \ \ \text{from: 3-p20}
$$

$$
\text{n varies from 0.7 at sea-level to 1 at cruise}
$$

### Step 6: \\(K_A\\) & \\(K_T\\) coefficient

$$
K_T=\frac{T_{T/O}}{W}-\mu=\frac{134350}{55000\times 9.81}-0.03=0.219\ \ \ \ \ \ \ \ \text{from: 4-p13, p15}
$$

$$
K_A=\frac{\rho}{2(\frac{W}{S})}(C_{D_{T/O}}-\mu C_{L_{T/O}})=\frac{1.155}{2\times(55000\times 9.81\div 95)}\cdot(0.0592-0.03\times 0.1)=5.71\times 10^{-6}\ \ \ \ \ \ \ \ \text{from: 4-pdf15}
$$

### Step 7: Calculate Ground Roll

$$
S_g=\frac{1}{2gK_A}\ln{(1+\frac{K_A}{K_T}V_R^2)}+NV_R=\frac{1}{2\times 9.81\times 5.71\times 10^{-6}}\ln{(1+\frac{5.71\times 10^{-6}}{0.219}\times 70.41^2)+ 3\times 70.41}=1296.3m
$$

$$
\text{N choose 3 because of large aircraft, from: 4-p15}
$$

### Step 8: Calculate \\(S_a\\)

$$
R=\frac{6.96V_{st}^2}{g}=\frac{6.96\times 64.01^2}{9.81}=2907m\ \ \ \ \ \ \ \ \text{from: 4-p19}
$$

$$
h_{obs}\text{ set 35ft}\ \ \ \ \ \ \ \ \text{from: 4-p11}
$$

$$
\theta_{obs}=\cos^{-1}{(1-\frac{h}{R})}=\cos^{-1}{(1-\frac{35\times 0.3048}{2907})}=4.91^\circ\ \ \ \ \ \ \ \ \text{from: 4-p19}
$$

$$
S_a=R\sin(\theta_{obs})=2907\times \sin{4.91}=248.8m
$$

### Step Final:

$$
S=S_g+S_a=1296.3+248.8=1545m
$$


End.


