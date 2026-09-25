import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "db.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function withReorderFlag(material) {
  return { ...material, needsOrder: material.stock <= material.minStock };
}

const MOVEMENT_TYPES = ["приход", "выдача", "перемещение", "возврат", "списание"];

// --- Материалы ---

app.get("/api/materials", (req, res) => {
  const db = readDb();
  res.json(db.materials.map(withReorderFlag));
});

app.post("/api/materials", (req, res) => {
  const { code, name, unit, stock, minStock } = req.body;
  if (!code || !name) return res.status(400).json({ error: "Код и название обязательны" });
  const db = readDb();
  if (db.materials.some((m) => m.code === code)) {
    return res.status(400).json({ error: "Материал с таким кодом уже есть" });
  }
  const material = {
    id: crypto.randomUUID(),
    code: code.trim(),
    name: name.trim(),
    unit: unit || "шт",
    stock: Number(stock) || 0,
    minStock: Number(minStock) || 0,
  };
  db.materials.push(material);
  writeDb(db);
  res.status(201).json(withReorderFlag(material));
});

app.get("/api/reorder", (req, res) => {
  const db = readDb();
  res.json(db.materials.filter((m) => m.stock <= m.minStock).map(withReorderFlag));
});

// --- Движения ---

app.get("/api/movements", (req, res) => {
  const db = readDb();
  const { materialId, type } = req.query;
  let movements = db.movements;
  if (materialId) movements = movements.filter((m) => m.materialId === materialId);
  if (type) movements = movements.filter((m) => m.type === type);
  res.json(movements.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post("/api/movements", (req, res) => {
  const { materialId, type, qty, fromPost, toPost, comment } = req.body;
  const qtyNum = Number(qty);
  if (!MOVEMENT_TYPES.includes(type)) {
    return res.status(400).json({ error: "Недопустимый тип движения" });
  }
  if (!qtyNum || qtyNum <= 0) {
    return res.status(400).json({ error: "Количество должно быть больше нуля" });
  }
  if (type === "перемещение" && (!fromPost || !toPost)) {
    return res.status(400).json({ error: "Для перемещения укажите посты «откуда» и «куда»" });
  }
  const db = readDb();
  const material = db.materials.find((m) => m.id === materialId);
  if (!material) return res.status(400).json({ error: "Материал не найден" });

  if ((type === "выдача" || type === "списание") && material.stock < qtyNum) {
    return res.status(400).json({ error: `Недостаточно на складе: остаток ${material.stock} ${material.unit}` });
  }

  if (type === "приход" || type === "возврат") material.stock += qtyNum;
  if (type === "выдача" || type === "списание") material.stock -= qtyNum;
  // перемещение не меняет общий остаток

  const movement = {
    id: crypto.randomUUID(),
    materialId,
    materialCode: material.code,
    materialName: material.name,
    type,
    qty: qtyNum,
    unit: material.unit,
    fromPost: fromPost || "",
    toPost: toPost || "",
    comment: comment || "",
    stockAfter: material.stock,
    createdAt: new Date().toISOString(),
  };
  db.movements.push(movement);
  writeDb(db);
  res.status(201).json({ movement, material: withReorderFlag(material) });
});

// --- Инвентаризация ---

app.get("/api/inventory", (req, res) => {
  const db = readDb();
  res.json(db.inventory.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post("/api/inventory", (req, res) => {
  const { materialId, factQty, comment } = req.body;
  const factNum = Number(factQty);
  if (Number.isNaN(factNum) || factNum < 0) {
    return res.status(400).json({ error: "Укажите корректное фактическое количество" });
  }
  const db = readDb();
  const material = db.materials.find((m) => m.id === materialId);
  if (!material) return res.status(400).json({ error: "Материал не найден" });

  const systemQty = material.stock;
  const diff = factNum - systemQty;
  material.stock = factNum;

  const record = {
    id: crypto.randomUUID(),
    materialId,
    materialCode: material.code,
    materialName: material.name,
    systemQty,
    factQty: factNum,
    diff,
    comment: comment || "",
    createdAt: new Date().toISOString(),
  };
  db.inventory.push(record);

  if (diff !== 0) {
    db.movements.push({
      id: crypto.randomUUID(),
      materialId,
      materialCode: material.code,
      materialName: material.name,
      type: "корректировка",
      qty: Math.abs(diff),
      unit: material.unit,
      fromPost: "",
      toPost: "",
      comment: `Корректировка по итогам инвентаризации (${diff > 0 ? "излишек" : "недостача"})`,
      stockAfter: material.stock,
      createdAt: new Date().toISOString(),
    });
  }

  writeDb(db);
  res.status(201).json({ record, material: withReorderFlag(material) });
});

app.get("/api/export.csv", (req, res) => {
  const db = readDb();
  const header = "date,type,material,qty,unit,fromPost,toPost,stockAfter,comment\n";
  const rows = db.movements
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((m) =>
      [
        m.createdAt,
        m.type,
        `"${m.materialName.replace(/"/g, '""')}"`,
        m.qty,
        m.unit,
        m.fromPost,
        m.toPost,
        m.stockAfter,
        `"${(m.comment || "").replace(/"/g, '""')}"`,
      ].join(",")
    );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=movements.csv");
  res.send(header + rows.join("\n"));
});

const PORT = process.env.PORT || 3400;
app.listen(PORT, () => {
  console.log(`QR-склад MVP запущен: http://localhost:${PORT}`);
});
