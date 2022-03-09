---
id: Aggregator
title: Aggregators in Arbitrum
sidebar_label: Aggregators
---

聚合器与以太坊网络中的节点有着相同的功能， 客户端可以使用API向聚合器发送远程调用请求（RPCs）以和Arbitrum网络交互。 与以太坊节点一样，之后聚合器将会向EthBridge发送请求并且将交易结果返回给客户端。

大多数客户端可以使用聚合器来提交他们Arbitrum的交易，即使这不是必要的。 至于网络中可以存在多少聚合器，谁可以成为聚合器都没有数量限制。

为了提高效率，集合器通常将多个客户交易合并成一个单一的信息，并提交给Arbitrum网络。
