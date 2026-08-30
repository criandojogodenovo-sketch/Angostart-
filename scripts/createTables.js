/**
 * AngoStart — Criação das tabelas no Neon PostgreSQL
 * Tabelas: users, products, orders
 *
 * Executar: node --env-file=.env.local scripts/createTables.js
 * (usa @neondatabase/serverless → funciona sobre HTTPS:443 em qualquer ambiente)
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL não definida ou inválida. Cria o ficheiro .env.local com a connection string do Neon.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    password_hash VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    price_kz INTEGER NOT NULL CHECK (price_kz >= 0),
    type VARCHAR(50) NOT NULL CHECK (type IN ('infoproduto','produto_fisico','servico_domicilio','servico_remoto')),
    icon VARCHAR(50) NOT NULL DEFAULT 'package',
    gradient VARCHAR(120) NOT NULL DEFAULT 'from-emerald-500 to-teal-600',
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    rating NUMERIC(2,1) NOT NULL DEFAULT 4.5,
    stock INTEGER NOT NULL DEFAULT -1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    customer_email VARCHAR(255),
    items JSONB NOT NULL,
    total_kz INTEGER NOT NULL CHECK (total_kz >= 0),
    status VARCHAR(50) NOT NULL DEFAULT 'pendente',
    delivery_type VARCHAR(50) NOT NULL DEFAULT 'retirada',
    notes TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    comprovativo_url TEXT,
    payment_method VARCHAR(20) NOT NULL DEFAULT 'kwik',
    payment_proof TEXT,
    payment_proof_name TEXT,
    payment_proof_type TEXT,
    admin_note TEXT,
    validated_at TIMESTAMPTZ,
    validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivery_address TEXT,
    service_completed BOOLEAN NOT NULL DEFAULT FALSE,
    service_completed_at TIMESTAMPTZ,
    service_started_at TIMESTAMPTZ,
    prestador_lat DOUBLE PRECISION,
    prestador_lng DOUBLE PRECISION,
    prestador_loc_updated_at TIMESTAMPTZ,
    tracking_active BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_products_type ON products(type)`,
  `CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE INDEX IF NOT EXISTS idx_orders_tracking_active ON orders(tracking_active) WHERE tracking_active = TRUE`,
  `CREATE INDEX IF NOT EXISTS idx_users_is_available ON users(is_available) WHERE is_available = TRUE`,
];

const PRODUCTS = [
  // ── Infoprodutos ──────────────────────────────────────────────
  ['eBook: Marketing Digital em Angola', 'Guia prático com estratégias de vendas online adaptadas ao mercado angolano: WhatsApp Business, Facebook e Instagram. 120 páginas com casos reais de Luanda.', 12500, 'infoproduto', 'book-open', 'from-emerald-500 to-teal-600', true, 4.8, -1],
  ['Curso Online: Excel para Negócios', 'Aprende Excel do básico ao avançado com foco em gestão de pequenas empresas: facturas, stock e relatórios. 8 módulos em vídeo + certificado.', 25000, 'infoproduto', 'graduation-cap', 'from-blue-600 to-cyan-500', true, 4.9, -1],
  ['Pack de Templates: Plano de Negócios', 'Modelos editáveis de plano de negócios, facturação e controlo de stock prontos para empresas angolanas. Compatível com Word e Excel.', 15000, 'infoproduto', 'layout-template', 'from-violet-600 to-purple-500', false, 4.6, -1],
  ['Curso: Programação do Zero', 'Curso completo de introdução à programação web (HTML, CSS e JavaScript). Ideal para quem quer começar na área de tecnologia em Angola.', 45000, 'infoproduto', 'code-2', 'from-orange-500 to-amber-500', false, 4.7, -1],
  // ── Produtos Físicos ──────────────────────────────────────────
  ['Smartphone Samsung Galaxy A15 128GB', 'Telemóvel novo com ecrã de 6.5", câmara tripla de 50MP, bateria de 5000mAh e garantia de 12 meses. Lacrado, com factura.', 145000, 'produto_fisico', 'smartphone', 'from-slate-700 to-slate-900', true, 4.7, 8],
  ['Headset Bluetooth JBL Tune 520BT', 'Auscultadores sem fios com som Pure Bass, bateria para até 57 horas e microfone integrado. Perfeito para música e chamadas.', 25000, 'produto_fisico', 'headphones', 'from-rose-500 to-pink-600', false, 4.5, 15],
  ['Power Bank 20000mAh Carga Rápida', 'Carregador portátil com duas saídas USB e entrada USB-C, carga rápida de 22.5W. Ideal para falhas de energia e uso no dia-a-dia.', 18500, 'produto_fisico', 'battery-charging', 'from-lime-500 to-green-600', false, 4.4, 22],
  ['Ventilador de Mesa Oscilante 40cm', 'Ventilador silencioso de 3 velocidades com oscilação, ideal para o calor de Luanda. Poupa energia e tem garantia de 6 meses.', 22000, 'produto_fisico', 'wind', 'from-cyan-500 to-sky-600', false, 4.3, 10],
  // ── Serviço ao Domicílio ──────────────────────────────────────
  ['Limpeza Doméstica Completa (Diária)', 'Serviço de limpeza profissional para casas e apartamentos em Luanda: varrer, lavar, passar e organizar. Profissionais verificadas.', 10000, 'servico_domicilio', 'sparkles', 'from-emerald-500 to-green-600', true, 4.9, -1],
  ['Reparação Elétrica Residencial', 'Electricista certificado para instalações, reparações e substituição de disjuntores em casa. Atendimento em 24h com garantia de serviço.', 15000, 'servico_domicilio', 'zap', 'from-yellow-500 to-orange-500', false, 4.6, -1],
  ['Instalação de Ar Condicionado', 'Instalação profissional de AC split com material incluído e teste de funcionamento. Disponível para talões e empresas em Luanda.', 30000, 'servico_domicilio', 'air-vent', 'from-sky-500 to-blue-600', false, 4.7, -1],
  ['Reparação de Canalização (Fugas)', 'Técnico de canalização para fugas de água, torneiras e autocismos. Diagnóstico rápido e preço fechado antes do serviço.', 12000, 'servico_domicilio', 'wrench', 'from-indigo-500 to-blue-700', false, 4.5, -1],
  // ── Serviço Remoto ────────────────────────────────────────────
  ['Design de Logotipo Profissional', 'Logotipo único para o teu negócio com 3 propostas, revisões ilimitadas e ficheiros finais em todos os formatos (PNG, PDF, AI).', 35000, 'servico_remoto', 'palette', 'from-fuchsia-500 to-purple-600', true, 4.8, -1],
  ['Criação de Website Empresarial', 'Website profissional até 5 páginas, responsivo, otimizado para o Google e ligado ao teu WhatsApp. Entrega em 7 dias.', 120000, 'servico_remoto', 'globe', 'from-teal-500 to-cyan-600', false, 4.9, -1],
  ['Gestão de Redes Sociais (Mensal)', 'Gestão completa do Instagram e Facebook: 12 publicações por mês, stories, resposta a clientes e relatório de resultados.', 60000, 'servico_remoto', 'share-2', 'from-pink-500 to-rose-600', false, 4.6, -1],
];

(async () => {
  try {
    console.log('📂 A criar tabelas (users, products, orders)...');
    for (const stmt of DDL) {
      await sql.query(stmt);
    }
    console.log('✅ Tabelas criadas/verificadas com sucesso.');

    const existing = await sql`SELECT COUNT(*)::int AS n FROM products`;
    if (existing[0].n > 0) {
      console.log(`ℹ️  A tabela products já tem ${existing[0].n} registos — seed ignorado (usa scripts/reset-products.js para recomeçar).`);
    } else {
      console.log('🌱 A inserir produtos de exemplo...');
      for (const p of PRODUCTS) {
        await sql`
          INSERT INTO products (name, description, price_kz, type, icon, gradient, featured, rating, stock)
          VALUES (${p[0]}, ${p[1]}, ${p[2]}, ${p[3]}, ${p[4]}, ${p[5]}, ${p[6]}, ${p[7]}, ${p[8]})
        `;
      }
      console.log(`✅ ${PRODUCTS.length} produtos inseridos.`);
    }

    const counts = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM products) AS products,
        (SELECT COUNT(*)::int FROM orders) AS orders
    `;
    console.log('📊 Estado da base de dados:', counts[0]);
    console.log('🎉 Base de dados AngoStart pronta no Neon!');
  } catch (err) {
    console.error('❌ ERRO:', err.message);
    process.exit(1);
  }
})();
