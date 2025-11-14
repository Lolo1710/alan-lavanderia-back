import express from "express";
import cors from "cors";
import { db } from "./db.js";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import path from "path";

const app = express();
app.use(express.json());
app.use(cors(
    ["https://alan-web-0dsvdy-01e447-72-60-121-26.traefik.me"]
));

const ROLE_CLIENTE = 3;
const JWT_SECRET = "supersecreto123";

const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
        user: "maattos07@gmail.com",       // reemplaza con tu correo
        pass: "kyfh yeng qzvl vrmf",  // si usas Gmail, genera App Password
    },
});

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ ok: false, mensaje: "No token" });

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Guardamos info del usuario en la request
        next();
    } catch (err) {
        return res.status(401).json({ ok: false, mensaje: "Token inválido" });
    }
}

// Ruta para obtener datos del usuario para actualizar perfil
app.get("/", authMiddleware, async (req, res) => {
    try {
        res.json("API Lavanderia funcionando");
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error del servidor" });
    }
});

// Ruta para obtener datos del usuario para actualizar perfil
app.get("/profile", authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT id, nombre_completo, telefono, direccion, correo FROM clientes WHERE id_usuario = ?",
            [req.user.id]
        );

        if (rows.length === 0) return res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });

        res.json({ ok: true, user: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error del servidor" });
    }
});

// Actualizar datos del usuario (users + clientes)
app.put("/usuario", authMiddleware, async (req, res) => {
    const userId = req.user.id; // viene del token
    const { nombre_completo, correo, telefono, direccion } = req.body;

    try {
        // Actualiza tabla users
        await db.query(
            "UPDATE users SET name = ?, email = ?, updated_at = NOW() WHERE id = ?",
            [nombre_completo, correo, userId]
        );

        // Actualiza tabla clientes
        await db.query(
            "UPDATE clientes SET nombre_completo = ?, telefono = ?, direccion = ?, updated_at = NOW() WHERE id_usuario = ?",
            [nombre_completo, telefono, direccion, userId]
        );

        res.json({ ok: true, mensaje: "Datos actualizados correctamente" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error al actualizar datos" });
    }
});

// Cambiar contraseña
app.put("/usuario/password", authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    try {
        const [rows] = await db.query("SELECT password FROM users WHERE id = ?", [userId]);
        if (rows.length === 0) return res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });

        const user = rows[0];
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) return res.status(401).json({ ok: false, mensaje: "Contraseña actual incorrecta" });

        const newHash = await bcrypt.hash(newPassword, 12);
        await db.query("UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?", [newHash, userId]);

        res.json({ ok: true, mensaje: "Contraseña actualizada correctamente" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error al cambiar la contraseña" });
    }
});

app.get("/pedidos", authMiddleware, async (req, res) => {
    const userId = req.user.id;

    try {
        const [pedidos] = await db.query(
            `SELECT p.id, p.fecha_pedido, p.estado, p.total,
              GROUP_CONCAT(CONCAT(d.id,'-',s.nombre_servicio,'-',d.peso_kg,'kg','-$',d.subtotal) SEPARATOR ',') AS detalles
       FROM pedidos p
       LEFT JOIN detalle_pedidos d ON p.id = d.id_pedido
       LEFT JOIN servicios s ON d.id_servicio = s.id
       WHERE p.id_cliente = ?
       GROUP BY p.id
       ORDER BY p.fecha_pedido DESC`,
            [userId]
        );

        const [entregas] = await db.query(
            `SELECT * FROM entregas e
             JOIN pedidos p ON p.id = e.id_pedido
             WHERE p.id_cliente = ?`,
            [userId]
        );

        res.json({ ok: true, pedidos, entregas });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error al obtener pedidos" });
    }
});

app.get("/servicios", authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, nombre_servicio, precio_kg FROM servicios WHERE estado = 1");
        res.json({ ok: true, servicios: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error al obtener servicios" });
    }
});

// Crear un nuevo pedido
app.post("/crear-pedido", authMiddleware, async (req, res) => {
    const { items } = req.body;
    const clienteId = req.user.id;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ ok: false, mensaje: "Debe enviar al menos un servicio" });
    }

    try {
        // 1️⃣ Calcular total
        let total = 0;
        for (let item of items) {
            const [serv] = await db.query("SELECT precio_kg FROM servicios WHERE id = ?", [item.id_servicio]);
            if (!serv[0]) return res.status(400).json({ ok: false, mensaje: "Servicio no encontrado" });
            total += serv[0].precio_kg * item.peso_kg;
        }

        // 2️⃣ Insertar en pedidos
        const [pedido] = await db.query(
            "INSERT INTO pedidos (id_cliente, fecha_pedido, estado, total, created_at, updated_at) VALUES (?, NOW(), ?, ?, NOW(), NOW())",
            [clienteId, "pendiente", total]
        );
        const pedidoId = pedido.insertId;

        // 3️⃣ Insertar en detalle_pedidos
        for (let item of items) {
            const [serv] = await db.query("SELECT precio_kg FROM servicios WHERE id = ?", [item.id_servicio]);
            const subtotal = serv[0].precio_kg * item.peso_kg;

            await db.query(
                "INSERT INTO detalle_pedidos (id_pedido, id_servicio, peso_kg, subtotal, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())",
                [pedidoId, item.id_servicio, item.peso_kg, subtotal]
            );
        }

        // 4️⃣ Opcional: crear registro inicial en entregas
        await db.query(
            "INSERT INTO entregas (id_pedido, created_at, updated_at) VALUES (?, NOW(), NOW())",
            [pedidoId]
        );

        res.json({ ok: true, mensaje: "Pedido creado correctamente", id_pedido: pedidoId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error al crear el pedido" });
    }
});

// Ruta para obtener datos del usuario logueado
app.get("/dashboard-data", authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT id, name, email, role_id as role FROM users WHERE id = ?",
            [req.user.id]
        );

        if (rows.length === 0) return res.status(404).json({ ok: false, mensaje: "Usuario no encontrado" });

        res.json({ ok: true, user: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error del servidor" });
    }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        // Buscar usuario por email
        const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);

        if (rows.length === 0) {
            return res.status(401).json({ ok: false, mensaje: "Usuario no encontrado" });
        }

        const user = rows[0];

        // Verificar contraseña
        const passwordValido = await bcrypt.compare(password, user.password);

        if (!passwordValido) {
            return res.status(401).json({ ok: false, mensaje: "Contraseña incorrecta" });
        }

        // Generar token JWT
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role_id },
            JWT_SECRET,
            { expiresIn: "8h" }
        );

        res.json({
            ok: true,
            mensaje: "Login exitoso",
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role_id,
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, mensaje: "Error del servidor" });
    }
});
app.post("/registro", async (req, res) => {
    const { empresa, contacto, email, telefono, descripcion } = req.body;

    try {
        const password = Math.random().toString(36).slice(-8);
        const passwordHash = await bcrypt.hash(password, 12);

        const [user] = await db.query(
            "INSERT INTO users (role_id, name, email, password, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
            [
                ROLE_CLIENTE,
                empresa,
                email,
                passwordHash,
                JSON.stringify({ locale: "es" }),
            ]
        );

        await db.query(
            "INSERT INTO clientes (id_usuario, nombre_completo, telefono, direccion, correo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
            [
                user.insertId,
                contacto,
                telefono,
                descripcion,
                email,
            ]
        );

        await transporter.sendMail({
            from: '"Lavanderia" <lavanderiacancun@gmail.com>',
            to: email,
            subject: "Tus credenciales de acceso",
            html: `
                <h2>Bienvenido a nuestra plataforma</h2>
                <p>Tu cuenta ha sido creada exitosamente.</p>
                <p><b>Email:</b> ${email}</p>
                <p><b>Contraseña:</b> ${password}</p>
                <p>Recuerda que puedes cambiar tu contraseña luego en tu panel.</p>
            `,
        });

        res.json({
            ok: true,
            mensaje: "Cliente registrado correctamente"
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ ok: false, error: err });
    }
});

app.listen(3001, () => console.log("API corriendo en 3001"));
