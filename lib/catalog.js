// Shared reference lists. Aspect codes and option lists mirror the survey
// "OIC_Trust_Score_V2_GoogleForm_Question_List_Rev3.xlsx" so survey answers
// and app reviews can be scored together.

export const ASPECTS = [
  { code: 'A1', group: 'A', th: 'เบี้ยประกันคุ้มค่าเมื่อเทียบกับความคุ้มครอง', en: 'Premium value for coverage' },
  { code: 'A2', group: 'A', th: 'ส่วนลด/โปรโมชันเมื่อซื้อหรือต่ออายุ', en: 'Discounts & renewal promotions' },
  { code: 'B1', group: 'B', th: 'ความครอบคลุมของกรมธรรม์', en: 'Breadth of coverage' },
  { code: 'B2', group: 'B', th: 'บริการเสริมพิเศษ (เช่น ช่วยเหลือฉุกเฉิน)', en: 'Extra services (e.g. roadside help)' },
  { code: 'C1', group: 'C', th: 'ชื่อเสียงและความน่าเชื่อถือของบริษัท', en: 'Company reputation' },
  { code: 'C2', group: 'C', th: 'คุณภาพคำแนะนำจากช่องทางที่ซื้อ', en: 'Advice quality from sales channel' },
  { code: 'D1', group: 'D', th: 'ความเป็นธรรมและความรวดเร็วในการเคลม', en: 'Claim fairness & speed' },
  { code: 'D2', group: 'D', th: 'จำนวนและคุณภาพศูนย์/อู่ซ่อม', en: 'Repair network size & quality' },
];

export const ASPECT_CODES = ASPECTS.map((a) => a.code);

export const GROUPS = {
  A: { th: 'ราคาและความคุ้มค่า', en: 'Price & value' },
  B: { th: 'ความคุ้มครองและบริการเสริม', en: 'Coverage & extras' },
  C: { th: 'ความน่าเชื่อถือและคำแนะนำ', en: 'Trust & advice' },
  D: { th: 'การเคลมและเครือข่ายซ่อม', en: 'Claims & repair network' },
};

// FICTIONAL insurers. The prototype never shows real company names; the survey importer
// (scripts/survey-import-lib.mjs, not published) maps the survey's real insurer answers onto these 12 slots.
// `code` is the prefix of the prototype's invented policy-number format.
export const INSURERS = [
  { id: 'aurora', code: 'AUR', short: 'Aurora', en: 'Aurora Insurance', th: 'ออโรร่าประกันภัย' },
  { id: 'banyan', code: 'BAN', short: 'Banyan', en: 'Banyan Insurance', th: 'บันยันประกันภัย' },
  { id: 'cobalt', code: 'COB', short: 'Cobalt', en: 'Cobalt Insurance', th: 'โคบอลต์ประกันภัย' },
  { id: 'deltashield', code: 'DSH', short: 'Delta', en: 'Delta Shield Insurance', th: 'เดลต้าชีลด์ประกันภัย' },
  { id: 'evergreen', code: 'EVG', short: 'Evergreen', en: 'Evergreen Insurance', th: 'เอเวอร์กรีนประกันภัย' },
  { id: 'falcon', code: 'FAL', short: 'Falcon', en: 'Falcon Insurance', th: 'ฟัลคอนประกันภัย' },
  { id: 'granite', code: 'GRN', short: 'Granite', en: 'Granite Insurance', th: 'แกรนิตประกันภัย' },
  { id: 'harbor', code: 'HBR', short: 'Harbor', en: 'Harbor Insurance', th: 'ฮาร์เบอร์ประกันภัย' },
  { id: 'iris', code: 'IRS', short: 'Iris', en: 'Iris Insurance', th: 'ไอริสประกันภัย' },
  { id: 'jade', code: 'JAD', short: 'Jade', en: 'Jade Insurance', th: 'เจดประกันภัย' },
  { id: 'kestrel', code: 'KST', short: 'Kestrel', en: 'Kestrel Insurance', th: 'เคสเตรลประกันภัย' },
  { id: 'lumen', code: 'LUM', short: 'Lumen', en: 'Lumen Insurance', th: 'ลูเมนประกันภัย' },
];

// Product lines an insurer can list (OIC requires every product sold to be listed with these fields).
export const PRODUCT_LINES = [
  { id: 'prestige', cls: '1-dealer', name: 'Prestige 1', th: 'ชั้น 1 ซ่อมศูนย์ ความคุ้มครองเต็ม', en: 'Class 1, dealer repair, full cover' },
  { id: 'ev', cls: '1-dealer', name: 'EV Care 1', th: 'ชั้น 1 สำหรับรถไฟฟ้า รวมแบตเตอรี่', en: 'Class 1 for EVs, battery included' },
  { id: 'smart', cls: '1-garage', name: 'Smart 1', th: 'ชั้น 1 ซ่อมอู่ในเครือ', en: 'Class 1, partner-garage repair' },
  { id: 'easy', cls: '2plus', name: 'Easy 2+', th: 'ชั้น 2+ ชน รถหาย ไฟไหม้', en: 'Class 2+: collision, theft, fire' },
  { id: 'saver', cls: '3plus', name: 'Saver 3+', th: 'ชั้น 3+ เฉพาะชนกับยานพาหนะ', en: 'Class 3+: collision with vehicles' },
  { id: 'basic2', cls: '2', name: 'Basic 2', th: 'ชั้น 2 รถหาย ไฟไหม้ บุคคลภายนอก', en: 'Class 2: theft, fire, third party' },
  { id: 'basic3', cls: '3', name: 'Basic 3', th: 'ชั้น 3 บุคคลภายนอก', en: 'Class 3: third party only' },
];
// Fields every listed product must have (checked on the OIC dashboard).
export const PRODUCT_REQUIRED = ['premium_thb', 'deductible_thb', 'exclusions', 'claim_channel'];

export const POLICY_CLASSES = [
  { id: '1-dealer', th: 'ชั้น 1 (ซ่อมศูนย์)', en: 'Class 1 (dealer repair)' },
  { id: '1-garage', th: 'ชั้น 1 (ซ่อมอู่)', en: 'Class 1 (garage repair)' },
  { id: '2plus', th: 'ชั้น 2+', en: 'Class 2+' },
  { id: '3plus', th: 'ชั้น 3+', en: 'Class 3+' },
  { id: '2', th: 'ชั้น 2', en: 'Class 2' },
  { id: '3', th: 'ชั้น 3', en: 'Class 3' },
];

export const CHANNELS = [
  { id: 'dealer', th: 'แถมมากับการซื้อรถ', en: 'Bundled with car purchase' },
  { id: 'agent', th: 'ตัวแทนประกันภัย', en: 'Agent' },
  { id: 'telesales', th: 'Telesales', en: 'Telesales' },
  { id: 'broker', th: 'นายหน้าประกันภัย', en: 'Broker' },
  { id: 'online', th: 'ซื้อออนไลน์ด้วยตัวเอง', en: 'Online, self-service' },
  { id: 'bank', th: 'ผ่านธนาคาร', en: 'Bancassurance' },
];

export const REGIONS = [
  { id: 'bkk', th: 'กรุงเทพฯ และปริมณฑล', en: 'Bangkok & vicinity' },
  { id: 'central', th: 'ภาคกลาง', en: 'Central' },
  { id: 'east', th: 'ภาคตะวันออก', en: 'East' },
  { id: 'northeast', th: 'ภาคตะวันออกเฉียงเหนือ', en: 'Northeast' },
  { id: 'north', th: 'ภาคเหนือ', en: 'North' },
  { id: 'south', th: 'ภาคใต้', en: 'South' },
  { id: 'west', th: 'ภาคตะวันตก', en: 'West' },
];

export const CLAIM_TYPES = [
  { id: 'party', th: 'อุบัติเหตุมีคู่กรณี', en: 'Accident with another party' },
  { id: 'single', th: 'อุบัติเหตุไม่มีคู่กรณี', en: 'Single-vehicle accident' },
  { id: 'theft', th: 'รถหาย/ไฟไหม้/ภัยธรรมชาติ', en: 'Theft / fire / natural disaster' },
  { id: 'other', th: 'อื่นๆ', en: 'Other' },
];

export const PROVINCES = [
  'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา',
  'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก',
  'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน',
  'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา',
  'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต',
  'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี',
  'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ',
  'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี',
  'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี',
  'อุบลราชธานี',
];
