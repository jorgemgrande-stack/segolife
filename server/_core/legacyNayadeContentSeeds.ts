/**
 * legacyNayadeContentSeeds.ts — seeds de CATÁLOGO/CONTENIDO con marca real de
 * Náyade Experiences (experiencias, home de CMS), heredados del proyecto
 * original.
 *
 * ESTE ARCHIVO ESTÁ DELIBERADAMENTE DESCONECTADO. Ningún script de package.json
 * lo importa ni lo ejecuta — ni el arranque del servidor, ni `pnpm db:migrate`,
 * ni `pnpm db:seed`. Se conserva solo como referencia histórica de lo que el
 * arranque sembraba automáticamente antes de la fase de saneamiento (ver
 * CLAUDE.md). Si en el futuro Segolife necesita un seed de catálogo propio
 * (eventos, beneficios, comercios), debe escribirse desde cero con contenido
 * real de Segolife — no reactivar este archivo.
 *
 * A diferencia de server/_core/legacyMaintenance.ts (reparaciones de schema,
 * contenido-neutral, sí se ejecutan vía db:migrate), lo que hay aquí es
 * contenido de marca real de un tercero (textos, imágenes de su CDN, nombre
 * comercial "Náyade") — no debe llegar nunca a una base de datos de Segolife.
 */
import mysql from "mysql2/promise";

export async function seedExperiencesIfEmpty() {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    const [rows] = await conn.execute("SELECT COUNT(*) as cnt FROM experiences") as any[];
    const count = rows[0].cnt;
    if (count > 0) {
      console.log(`[LegacySeed] Experiencias ya presentes (${count}), se omite el seed`);
      await conn.end();
      return;
    }

    console.log("[LegacySeed] Tabla de experiencias vacía — restaurando catálogo heredado de Náyade...");

    const CDN = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads";

    await conn.execute(`INSERT IGNORE INTO categories (slug,name,isActive,sortOrder) VALUES
      ('actividades-acuaticas','Actividades Acuáticas',1,1),
      ('deportes-acuaticos','Deportes Acuáticos',1,2),
      ('spa-bienestar','SPA & Bienestar',1,3),
      ('piscina','Piscina & Baño',1,4)`);

    await conn.execute(`INSERT IGNORE INTO locations (slug,name,address,isActive,sortOrder) VALUES
      ('los-angeles-de-san-rafael','Los Ángeles de San Rafael','Club Náutico Los Ángeles de San Rafael, Segovia',1,1)`);

    const [[cat1]] = await conn.execute("SELECT id FROM categories WHERE slug='actividades-acuaticas'") as any;
    const [[cat2]] = await conn.execute("SELECT id FROM categories WHERE slug='deportes-acuaticos'") as any;
    const [[cat3]] = await conn.execute("SELECT id FROM categories WHERE slug='spa-bienestar'") as any;
    const [[cat4]] = await conn.execute("SELECT id FROM categories WHERE slug='piscina'") as any;
    const [[loc]]  = await conn.execute("SELECT id FROM locations WHERE slug='los-angeles-de-san-rafael'") as any;

    const A = cat1.id, D = cat2.id, S = cat3.id, P = cat4.id, L = loc.id;

    const experiences = [
      { slug:"paseo-en-barco", title:"Paseo en Barco", shortDescription:"Navega por las tranquilas aguas del embalse rodeado de vegetación y vistas panorámicas a la Sierra de Guadarrama.", description:"Una experiencia única surcando las apacibles aguas del embalse de Los Ángeles de San Rafael. A bordo disfrutarás de paisajes de ensueño, rodeado de vegetación frondosa y con las cumbres de la Sierra de Guadarrama como telón de fondo.", coverImageUrl:`${CDN}/1775049168929-vx1e7i.png`, image1:`${CDN}/1775049168929-vx1e7i.png`, image2:`${CDN}/1775049603095-8rkwvh.png`, image3:`${CDN}/1775049607679-rxudag.png`, image4:`${CDN}/1775049612665-6ts80x.png`, basePrice:"15.00", duration:"20 minutos", minPersons:1, maxPersons:50, difficulty:"facil", isFeatured:0, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Seguro de accidentes"]', excludes:'[]', sortOrder:1 },
      { slug:"entrada-general-piscina-club-nautico", title:"Entrada General Piscina Club Náutico", shortDescription:"Relájate en nuestra piscina a orillas del embalse con amplias zonas de solárium y baño.", description:"Disfruta de la piscina del Club Náutico de Los Ángeles de San Rafael con vistas a la Sierra de Guadarrama. Amplias zonas de solárium, acceso al lago y todas las comodidades para una jornada de descanso en familia o con amigos.", coverImageUrl:`${CDN}/1774281603494-er84vo.png`, image1:`${CDN}/1774281603494-er84vo.png`, image2:`${CDN}/1774281608106-4fqd45.png`, image3:`${CDN}/1774281619410-lefaql.png`, image4:null, basePrice:"7.00", duration:null, minPersons:11, maxPersons:100, difficulty:"facil", isFeatured:0, isActive:1, isPublished:1, isPresentialSale:1, categoryId:P, locationId:L, includes:'["Acceso a las instalaciones","Seguro de accidentes"]', excludes:'["Acceso a Bahía VIP"]', sortOrder:2 },
      { slug:"alquiler-dia-completo-tabla-de-wakeboard", title:"Alquiler Día Completo Tabla de Wakeboard", shortDescription:"Alquila tu tabla de wakeboard para todo el día y disfruta del embalse a tu ritmo combinando velocidad, equilibrio y adrenalina.", description:"Vive la experiencia del wakeboard durante un día completo en el embalse de Los Ángeles de San Rafael. La tabla te permitirá deslizarte sobre el agua combinando velocidad, equilibrio y adrenalina. Mínimo 2 personas.", coverImageUrl:`${CDN}/1775074493261-jccylv.jpg`, image1:`${CDN}/1775074493261-jccylv.jpg`, image2:`${CDN}/1775074605323-iygad1.webp`, image3:null, image4:null, basePrice:"45.00", duration:"1 día", minPersons:1, maxPersons:5, difficulty:"facil", isFeatured:0, isActive:1, isPublished:1, isPresentialSale:1, categoryId:D, locationId:L, includes:'["Tabla de wakeboard","Fijaciones/herrajes","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Neopreno"]', sortOrder:3 },
      { slug:"cableski-wakeboard", title:"Cableski & Wakeboard", shortDescription:"El sistema de cable aéreo continuo te propulsará sobre el agua haciendo wakeboard o esquí acuático. ¡Una experiencia que engancha desde la primera vuelta!", description:"El cableski de Náyade te permite practicar wakeboard o esquí acuático impulsado por un sistema de cable aéreo continuo, sin necesidad de lancha motora. No hace falta experiencia previa. Disponible por vueltas o en formato media jornada/jornada completa.", coverImageUrl:`${CDN}/1773766863713-7gry6r.jpg`, image1:`${CDN}/1773766863713-7gry6r.jpg`, image2:`${CDN}/1773766869680-r66be7.png`, image3:`${CDN}/1773766880496-2l6cdm.png`, image4:`${CDN}/1773766883661-g2yblj.png`, basePrice:"30.00", duration:null, minPersons:1, maxPersons:100, difficulty:"moderado", isFeatured:0, isActive:1, isPublished:1, isPresentialSale:1, categoryId:D, locationId:L, includes:'["Esquís, mono-ski o kneeboard","Chaleco salvavidas/protector","Seguro de accidentes"]', excludes:'["Tabla de wakeboard","Neopreno"]', sortOrder:4 },
      { slug:"blob-jump", title:"Blob Jump", shortDescription:"Lánzate desde una plataforma elevada sobre un giant blob inflable y sal despedido al aire antes de caer al lago. ¡Pura adrenalina!", description:"El Blob Jump es la actividad más impactante de Náyade. Te lanzas desde una plataforma elevada sobre un enorme colchón inflable (blob) que propulsa al compañero del extremo opuesto por los aires antes de caer al embalse. Disponible por saltos individuales o en bonos de 3 y 5 saltos.", coverImageUrl:`${CDN}/1773762402377-dymd02.png`, image1:`${CDN}/1773762402377-dymd02.png`, image2:`${CDN}/1773762413686-d56xu2.png`, image3:null, image4:null, basePrice:"8.00", duration:null, minPersons:1, maxPersons:20, difficulty:"dificil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Equipo protector (parachoques)","Seguro de accidentes","Chaleco salvavidas"]', excludes:'["Casco"]', sortOrder:5 },
      { slug:"canoas-kayaks", title:"Canoas & Kayaks", shortDescription:"Explora el embalse en canoa o kayak a tu propio ritmo. Deporte, paisaje y tranquilidad con vistas a la Sierra de Guadarrama.", description:"Navega por el embalse de Los Ángeles de San Rafael en canoa o kayak y descubre rincones únicos a tu ritmo. Actividad perfecta para todos los niveles que combina ejercicio suave, naturaleza y vistas espectaculares. Disponible en 1, 2 o 3 horas y Fórmula Familiar.", coverImageUrl:`${CDN}/1775063728570-x1kzd8.png`, image1:`${CDN}/1775063728570-x1kzd8.png`, image2:`${CDN}/1775063736967-y2tlnu.png`, image3:`${CDN}/1775063750522-nke2gs.png`, image4:`${CDN}/1775063846540-gcz3jp.png`, basePrice:"12.00", duration:"1 hora", minPersons:2, maxPersons:4, difficulty:"facil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Embarcación para 2 pasajeros","Remos para 2 personas","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Bolsa impermeable"]', sortOrder:6 },
      { slug:"paddle-surf", title:"Paddle Surf", shortDescription:"Practica el stand-up paddleboarding en las tranquilas aguas del embalse. Equilibrio, calma y diversión para todos los niveles.", description:"El Paddle Surf (SUP) es perfecto para disfrutar del embalse de manera activa y serena. De pie sobre la tabla, remando con una pala, explorarás las orillas del embalse. Accesible para principiantes y apto para toda la familia. Sesiones de 1 hora, 2 horas o Fórmula Familiar.", coverImageUrl:`${CDN}/1773774376430-cmec06.png`, image1:`${CDN}/1773774376430-cmec06.png`, image2:`${CDN}/1773774379647-stk79l.jpg`, image3:`${CDN}/1773774382023-qz52s0.jpg`, image4:`${CDN}/1773774392088-2ldmdb.jpg`, basePrice:"20.00", duration:"1 hora", minPersons:1, maxPersons:6, difficulty:"facil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Tabla individual","Remo/pala","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Bolsa estanca impermeable"]', sortOrder:7 },
      { slug:"banana-ski-donuts-copia-dRMV", title:"Donuts Ski", shortDescription:"La actividad más divertida para grupos: flota sobre un donut inflable remolcado por una lancha a alta velocidad, con giros y salpicones garantizados.", description:"El Donuts Ski es la actividad más divertida de Náyade. Subidos en un flotador circular de goma, serás remolcado por una lancha a alta velocidad por el embalse. Giros inesperados, saltos y salpicones constantes hacen de esta experiencia una risa garantizada. Grupos de 2 a 8 personas.", coverImageUrl:`${CDN}/1773863507321-ywvj6b.png`, image1:`${CDN}/1773863507321-ywvj6b.png`, image2:`${CDN}/1775034710820-bwhf5y.jpg`, image3:`${CDN}/1773702422261-h5ajd3.png`, image4:`${CDN}/1773702434768-wegear.png`, basePrice:"35.00", duration:"20 minutos", minPersons:2, maxPersons:8, difficulty:"moderado", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Equipo y flotador","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Neopreno"]', sortOrder:8 },
      { slug:"circuito-spa", title:"Circuito SPA Hidrotermal", shortDescription:"Circuito hidrotérmico completo con piscinas a distintas temperaturas, sauna finlandesa, baño turco y duchas de contraste.", description:"El Circuito SPA Hidrotermal de Náyade te ofrece una experiencia de bienestar completa. Incluye piscinas a diferentes temperaturas, chorros cervicales y lumbares, sauna finlandesa, baño turco y duchas de contraste. Precio especial para clientes del hotel.", coverImageUrl:`${CDN}/1773867774581-gde9k3.png`, image1:`${CDN}/1773867774581-gde9k3.png`, image2:`${CDN}/1773867780249-4it3ac.png`, image3:`${CDN}/1773867847070-xh6y0d.png`, image4:`${CDN}/1773867967358-gmcgyp.png`, basePrice:"18.00", duration:null, minPersons:6, maxPersons:20, difficulty:"facil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:S, locationId:L, includes:'["Acceso a todo el circuito hidrotermal","Piscinas a distintas temperaturas","Sauna finlandesa","Baño turco","Duchas de contraste","Seguro de accidentes"]', excludes:'[]', sortOrder:9 },
      { slug:"banana-ski-donuts", title:"Banana Ski", shortDescription:"La actividad más divertida y apta para todos los públicos: sentados en el flotador banana, la lancha os arrastrará a alta velocidad por el embalse.", description:"El Banana Ski es la actividad más popular de Náyade, ideal para grupos y familias. Sentados en un flotador en forma de banana, la lancha motora os remolcará a alta velocidad. Risas y emociones garantizadas. Mínimo 4 personas para la tarifa estándar.", coverImageUrl:`${CDN}/1773702396972-kd9hrk.png`, image1:`${CDN}/1773702396972-kd9hrk.png`, image2:`${CDN}/1773702409563-u54xhb.png`, image3:`${CDN}/1773702422261-h5ajd3.png`, image4:`${CDN}/1773702434768-wegear.png`, basePrice:"15.00", duration:"20 minutos", minPersons:4, maxPersons:8, difficulty:"moderado", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Seguro de accidentes"]', excludes:'[]', sortOrder:10 },
      { slug:"hidropedales", title:"Hidrobicis", shortDescription:"Pedalea sobre el agua y explora el embalse a tu ritmo. Una actividad tranquila y relajante perfecta para toda la familia.", description:"Las hidrobicis (hidropedales) son la opción perfecta para disfrutar del embalse de forma relajada. Pedaleando sobre el agua explorarás los rincones más tranquilos. Ideal para familias con niños. Sesiones de 1 hora, 2 horas o Fórmula Familiar.", coverImageUrl:`${CDN}/1773777174336-io6lvw.jpg`, image1:`${CDN}/1773777174336-io6lvw.jpg`, image2:`${CDN}/1773777177100-p1hzuw.jpg`, image3:`${CDN}/1773777198906-716boe.png`, image4:null, basePrice:"20.00", duration:"1 hora", minPersons:2, maxPersons:4, difficulty:"moderado", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Hidropedal","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Neopreno"]', sortOrder:11 },
      { slug:"aventura-hinchable", title:"Aventura Hinchable Acuática", shortDescription:"Parque inflable flotante en el lago con toboganes, trampolines y circuitos de obstáculos. ¡Diversión garantizada para todas las edades!", description:"La Aventura Hinchable Acuática es el parque de atracciones flotante de Náyade: un enorme recorrido inflable en el embalse con toboganes, trampolines y circuitos de obstáculos. Diversión para toda la familia. Sesiones de 30 y 60 minutos.", coverImageUrl:`${CDN}/1773778862239-e30o1s.png`, image1:`${CDN}/1773778862239-e30o1s.png`, image2:`${CDN}/1773778867350-w70k1r.png`, image3:`${CDN}/1773779017020-g7xxyf.png`, image4:null, basePrice:"8.00", duration:"1 hora", minPersons:1, maxPersons:30, difficulty:"facil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Seguro de accidentes"]', excludes:'[]', sortOrder:12 },
    ];

    for (const exp of experiences) {
      const cols = ["slug","title","shortDescription","description","coverImageUrl","image1","image2","image3","image4","basePrice","duration","minPersons","maxPersons","difficulty","isFeatured","isActive","isPublished","isPresentialSale","categoryId","locationId","includes","excludes","fiscalRegime","productType","pricing_type","sortOrder"];
      const vals = [exp.slug,exp.title,exp.shortDescription,exp.description,exp.coverImageUrl,exp.image1,exp.image2??null,exp.image3??null,exp.image4??null,exp.basePrice,exp.duration??null,exp.minPersons,exp.maxPersons,exp.difficulty,exp.isFeatured,exp.isActive,exp.isPublished,exp.isPresentialSale,exp.categoryId,exp.locationId,exp.includes,exp.excludes,"general","actividad","per_person",exp.sortOrder];
      const placeholders = cols.map(() => "?").join(",");
      await conn.execute(`INSERT IGNORE INTO experiences (${cols.join(",")}) VALUES (${placeholders})`, vals);
    }

    console.log("[LegacySeed] 12 experiencias heredadas de Náyade restauradas (archivo desconectado, no se ejecuta en Segolife)");
    await conn.end();
  } catch (err) {
    console.error("[LegacySeed] Error al hacer seed de experiencias:", err);
  }
}

export async function seedNayadeHomepageCms() {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);

    await conn.execute(
      `INSERT IGNORE INTO static_pages (slug, title, metaTitle, metaDescription, isPublished)
       VALUES (?, ?, ?, ?, 1)`,
      [
        "inicio",
        "Inicio — Náyade Experiences",
        "Náyade Experiences | Actividades acuáticas, Hotel y SPA en el Lago de Bolarque",
        "Experiencias acuáticas, hotel con vistas al lago, SPA y packs personalizados a 40 min de Madrid. Temporada Abril — Octubre 2026.",
      ]
    );
    const [existingBlocks] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM page_blocks WHERE pageSlug = 'inicio'`
    ) as any[];
    if ((existingBlocks as any[])[0]?.cnt === 0) {
      const blocks: [string, string, number, string][] = [
        ["inicio", "hero", 1, JSON.stringify({ title: "Diseñamos tu experiencia perfecta", subtitle: "Actividades acuáticas, relax, escapadas y aventura en el embalse de Los Angeles de San Rafael. A 40 min de Madrid.", imageUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg", ctaText: "Solicitar Presupuesto", ctaUrl: "/presupuesto", overlayOpacity: 55 })],
        ["inicio", "image_text", 5, JSON.stringify({ title: "Hotel Nayade — Vistas al Lago", body: "Alojate en el corazon de la naturaleza con vistas directas al embalse.", imageUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/d049863d-3421-411f-a64f-64eb34408da9_145ab8b4.png", imagePosition: "right", ctaText: "Ver Hotel", ctaUrl: "/hotel" })],
        ["inicio", "gallery", 7, JSON.stringify({ title: "Descubre Nayade", images: [`${"https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ"}/blob-jump2_94e0b06d.jpg`] })],
        ["inicio", "spacer", 12, JSON.stringify({ height: 40 })],
      ];
      for (const [pageSlug, blockType, sortOrder, data] of blocks) {
        await conn.execute(
          `INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (?, ?, ?, ?, 1)`,
          [pageSlug, blockType, sortOrder, data]
        );
      }
      console.log("[LegacySeed] CMS: bloques de la home 'inicio' con marca Náyade insertados (archivo desconectado)");
    }

    await conn.end();
  } catch (err) {
    console.error("[LegacySeed] Error en seedNayadeHomepageCms:", err);
  }
}
