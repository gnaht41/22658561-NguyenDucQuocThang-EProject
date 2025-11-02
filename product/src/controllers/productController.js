const Product = require("../models/product");
const messageBroker = require("../utils/messageBroker");
const uuid = require('uuid');

/**
 * Class to hold the API implementation for the product services
 */
class ProductController {

  constructor() {
    // Binding 'this' cho các phương thức để đảm bảo ngữ cảnh đúng khi gọi từ router
    this.createOrder = this.createOrder.bind(this);
    this.getOrderStatus = this.getOrderStatus.bind(this);
    // Lưu trạng thái đơn hàng tạm thời trong bộ nhớ (Memory)
    this.ordersMap = new Map();

  }

  async createProduct(req, res, next) {
    try {
      const token = req.headers.authorization;
      if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const product = new Product(req.body);

      const validationError = product.validateSync();
      if (validationError) {
        return res.status(400).json({ message: validationError.message });
      }

      await product.save({ timeout: 30000 });

      res.status(201).json(product);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }

  async createOrder(req, res, next) {
    try {
      const token = req.headers.authorization;
      if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { ids } = req.body;
      const products = await Product.find({ _id: { $in: ids } });

      const orderId = uuid.v4(); // Generate a unique order ID
      // Lưu trạng thái ban đầu của đơn hàng vào ordersMap (trong bộ nhớ)
      this.ordersMap.set(orderId, {
        status: "pending",
        products,
        username: req.user.username
      });

      // Gửi tin nhắn đến queue 'orders' trên RabbitMQ
      await messageBroker.publishMessage("orders", {
        products,
        username: req.user.username,
        orderId, // include the order ID in the message to orders queue
      });

      // Lắng nghe (consume) tin nhắn từ queue 'products' (nơi Order service gửi kết quả về)
      messageBroker.consumeMessage("products", (data) => {
        // Parse dữ liệu từ message (đã được Order service gửi về)
        const orderData = JSON.parse(JSON.stringify(data));
        const { orderId } = orderData;
        // Tìm đơn hàng tương ứng trong ordersMap
        const order = this.ordersMap.get(orderId);
        if (order) {
          // update the order in the map
          this.ordersMap.set(orderId, { ...order, ...orderData, status: 'completed' });
          console.log("Updated order:", order);
        }
      });

      // Long polling until order is completed
      let order = this.ordersMap.get(orderId);
      while (order.status !== 'completed') {
        await new Promise(resolve => setTimeout(resolve, 1000)); // wait for 1 second before checking status again
        order = this.ordersMap.get(orderId);
      }

      // Once the order is marked as completed, return the complete order details
      return res.status(201).json(order);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }

  // API để kiểm tra trạng thái đơn hàng (dùng orderId) 
  async getOrderStatus(req, res, next) {
    const { orderId } = req.params;
    const order = this.ordersMap.get(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    return res.status(200).json(order);
  }

  async getProducts(req, res, next) {
    try {
      const token = req.headers.authorization;
      if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const products = await Product.find({});

      res.status(200).json(products);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }

  async getProductById(req, res, next) {
    try {
      const token = req.headers.authorization;
      if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const productId = req.params.id;

      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.status(200).json(product);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }

}

module.exports = ProductController;
