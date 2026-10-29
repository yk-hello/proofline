# 公式渲染测试

行内：设 $f(x) = \sum_{i=1}^{n} a_i x^i$，其中 $a_1, a_2$ 为系数，$x^*$ 为最优解，$\|\nabla f\|_2 \le \epsilon$。价格 $5 和 $10 不是公式。

块级多行：

$$
\begin{aligned}
\mathcal{L}(\theta) &= -\frac{1}{N}\sum_{i=1}^{N} \log p_\theta(y_i \mid x_i) \\
&\quad + \lambda \|\theta\|_2^2
\end{aligned}
$$

矩阵与分段：

$$
A = \begin{pmatrix} a_{11} & a_{12} & \cdots \\ a_{21} & a_{22} & \cdots \\ \vdots & \vdots & \ddots \end{pmatrix},\quad
g(x) = \begin{cases} x^2, & x \ge 0 \\ -x, & x < 0 \end{cases}
$$

积分与极限：$$\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$$

\[ \lim_{n\to\infty}\left(1+\frac{1}{n}\right)^n = e \]

带星号：$a * b * c$ 与 $\mathbb{E}_{x\sim p}[x]$，$\operatorname{softmax}(z)_j = \frac{e^{z_j}}{\sum_k e^{z_k}}$。

表格中：

| 名称 | 公式 |
| --- | --- |
| 欧拉 | $e^{i\pi} + 1 = 0$ |
| 方差 | $\sigma^2 = \mathbb{E}[(X-\mu)^2]$ |

代码中不渲染：`$x_1$` 保持原样。
