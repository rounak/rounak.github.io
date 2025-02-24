---
layout: post
title:  "Hello World - Testing Features"
date:   2024-02-24 12:00:00 +0000
categories: test
---

# Testing Various Features

## 1. Syntax Highlighting

Here's a Python code example:

```python
def fibonacci(n):
    if n <= 1:
        return n
    else:
        return fibonacci(n-1) + fibonacci(n-2)

# Generate first 10 Fibonacci numbers
for i in range(10):
    print(fibonacci(i))
```

And some JavaScript:

```javascript
const greet = (name) => {
    console.log(`Hello, ${name}!`);
};

greet('World');
```

## 2. LaTeX Math

Let's test some inline math: \\(E = mc^2\\) and also \\(F = ma\\)

And here's a display math equation:

$$
\frac{d}{dx} \left( \int_{0}^x f(t) dt \right) = f(x)
$$

The quadratic formula is:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

Here's a numbered equation:

$$
\begin{equation}
\nabla \times \mathbf{B} = \mu_0\left(\mathbf{J} + \varepsilon_0\frac{\partial \mathbf{E}}{\partial t}\right)
\end{equation}
$$

## 3. Image Embedding

Here's an example image (replace with your actual image URL):

![Sample Image](https://via.placeholder.com/400x200)

You can also use relative paths for local images:

![Local Image](/assets/images/sample.jpg)

## 4. Combined Example

Here's a mathematical formula with code and explanation:

The time complexity of the Fibonacci function above is \\(O(2^n)\\) because each call branches into two recursive calls, creating a binary tree of depth n.

```python
# Time complexity: O(2^n)
def improved_fibonacci(n, memo={}):
    if n in memo:
        return memo[n]
    if n <= 1:
        return n
    memo[n] = improved_fibonacci(n-1, memo) + improved_fibonacci(n-2, memo)
    return memo[n]
```

This memoized version has a time complexity of \\(O(n)\\). 