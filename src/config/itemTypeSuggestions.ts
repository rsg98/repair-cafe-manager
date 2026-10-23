/**
 * @file src/config/itemTypeSuggestions.ts
 *
 * Curated catalogue of common household item types brought to Repair Café sessions,
 * paired with their default `ItemCategory` and `PowerType` classifications for
 * the Customer Registration View (`/register`) autocomplete input.
 */

import { ItemCategory, PowerType } from '../types';

/**
 * Autocomplete suggestion entry mapping a common household item type to its
 * default `ItemCategory` and `PowerType` on the Customer Registration View (`/register`).
 */
export interface ItemTypeSuggestion {
  label: string;
  category: ItemCategory;
  powerType: PowerType;
  keywords?: readonly string[];
  /** True when this option represents the customer's custom-typed string rather than a predefined catalogue entry. */
  isCustom?: boolean;
}

/**
 * Curated catalogue of common household item types brought to Repair Café sessions,
 * paired with their appropriate `ItemCategory` and `PowerType` classifications.
 */
export const ITEM_TYPE_SUGGESTIONS: ReadonlyArray<ItemTypeSuggestion> = [
  // Mains 240V Electrical & Electronic Appliances
  { label: 'Toaster', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['toast', 'bread toaster'] },
  { label: 'Kettle', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['jug kettle', 'water boiler'] },
  { label: 'Vacuum Cleaner', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['hoover', 'upright vacuum', 'cylinder vacuum'] },
  { label: 'Coffee Machine', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['espresso', 'coffee maker', 'coffee grinder', 'cafetiere'] },
  { label: 'Iron / Steam Iron', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['clothes iron', 'steam generator'] },
  { label: 'Hair Dryer', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['hairdryer', 'blow dryer'] },
  { label: 'Hair Straighteners', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['curling tongs', 'hair curler', 'styler'] },
  { label: 'Lamp', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['table lamp', 'floor lamp', 'desk lamp', 'bedside lamp', 'standard lamp', 'light'] },
  { label: 'Radio', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['dab radio', 'fm radio', 'clock radio'] },
  { label: 'Sewing Machine', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['overlocker'] },
  { label: 'Food Processor', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['chopper', 'mini chopper'] },
  { label: 'Blender', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['liquidiser', 'hand blender', 'stick blender', 'smoothie maker'] },
  { label: 'Stand Mixer', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['food mixer', 'hand mixer', 'whisk'] },
  { label: 'Microwave', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['microwaves', 'microwave oven'] },
  { label: 'Air Fryer', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['airfryer'] },
  { label: 'Slow Cooker', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['rice cooker', 'soup maker', 'crockpot'] },
  { label: 'Bread Maker', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['breadmaker'] },
  { label: 'Fan', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['desk fan', 'pedestal fan', 'tower fan', 'cooling fan'] },
  { label: 'Heater', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['fan heater', 'convector heater', 'oil radiator', 'electric heater'] },
  { label: 'Dehumidifier', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['humidifier', 'air purifier'] },
  { label: 'CD Player', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['boombox', 'stereo', 'mini system'] },
  { label: 'Record Player', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['turntable', 'vinyl player', 'gramophone'] },
  { label: 'Hi-Fi / Amplifier', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['amp', 'receiver', 'tuner', 'subwoofer'] },
  { label: 'Cassette Player', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['tape deck', 'tape recorder', 'cassette deck'] },
  { label: 'Television', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['tv', 'monitor', 'dvd player'] },
  { label: 'Printer', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['scanner', 'inkjet', 'laser printer'] },
  { label: 'Paper Shredder', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['shredder'] },
  { label: 'Lawn Mower', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['mower', 'lawnmower'] },
  { label: 'Hedge Trimmer', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['strimmer', 'leaf blower', 'garden vac'] },
  { label: 'Pressure Washer', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['jet wash'] },
  { label: 'Power Drill', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['sander', 'jigsaw', 'circular saw', 'angle grinder'] },
  { label: 'Extension Lead', category: 'ELECTRICAL', powerType: 'MAINS_240V', keywords: ['power strip', 'cable reel', 'power adapter'] },

  // Battery / USB / Low-Voltage Electrical & Electronic Devices
  { label: 'Laptop', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['notebook', 'macbook', 'chromebook'] },
  { label: 'Mobile Phone', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['smartphone', 'iphone', 'android', 'telephone'] },
  { label: 'Tablet', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['ipad', 'kindle', 'e-reader'] },
  { label: 'Cordless Vacuum', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['handheld vacuum', 'stick vacuum', 'dustbuster'] },
  { label: 'Headphones', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['earphones', 'earbuds', 'airpods', 'headset'] },
  { label: 'Bluetooth Speaker', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['portable speaker', 'wireless speaker'] },
  { label: 'Portable Radio', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['battery radio', 'pocket radio', 'walkman'] },
  { label: 'Digital Camera', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['camera', 'camcorder'] },
  { label: 'Battery Clock', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['quartz clock', 'wall clock', 'alarm clock', 'carriage clock'] },
  { label: 'Quartz Watch', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['wristwatch', 'battery watch', 'smartwatch'] },
  { label: 'Electric Toothbrush', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['shaver', 'beard trimmer', 'water flosser'] },
  { label: 'Torch', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['flashlight', 'bike light', 'lantern', 'fairy lights', 'solar light'] },
  { label: 'Remote Control', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['tv remote', 'controller', 'key fob'] },
  { label: 'Electric Bike', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['e-bike', 'ebike', 'electric bikes', 'electric bicycle', 'pedelec'] },
  { label: 'Electric Scooter', category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['e-scooter', 'escooter', 'electric scooters', 'scooter', 'scooters', 'mobility scooter'] },

  // Mechanical Items, Clocks, Bikes & Tools
  { label: 'Bicycle', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['bike', 'mountain bike', 'road bike', 'folding bike'] },
  {
    label: 'Petrol-Driven Item',
    category: 'MECHANICAL',
    powerType: 'OTHER',
    keywords: [
      'petrol',
      'petrol-driven',
      'petrol driven',
      'petrol-driven items',
      'petrol mower',
      'petrol lawn mower',
      'petrol lawnmower',
      'petrol strimmer',
      'petrol chainsaw',
      'petrol hedge trimmer',
      'petrol generator',
      'two-stroke',
      'four-stroke'
    ]
  },
  { label: 'Mechanical Clock', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['mantel clock', 'cuckoo clock', 'pendulum clock', 'wind-up clock'] },
  { label: 'Mechanical Watch', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['automatic watch', 'pocket watch'] },
  { label: 'Secateurs', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['garden shears', 'loppers', 'pruners', 'hedge shears', 'garden tool'] },
  { label: 'Knife / Scissors', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['kitchen knife', 'shears', 'blade sharpening'] },
  { label: 'Pram / Pushchair', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['buggy', 'stroller'] },
  { label: 'Suitcase', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['luggage', 'wheeled bag', 'trolley'] },
  { label: 'Umbrella', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['brolly', 'parasol'] },
  { label: 'Spectacles / Glasses', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['sunglasses', 'reading glasses', 'frames'] },
  { label: 'Walking Frame', category: 'MECHANICAL', powerType: 'MECHANICAL', keywords: ['rollator', 'walking stick', 'mobility aid'] },

  // Textiles, Clothing & Bags
  { label: 'Coat / Jacket', category: 'TEXTILES', powerType: 'NOT_APPLICABLE', keywords: ['coat', 'jacket', 'anorak', 'parka', 'raincoat', 'blazer', 'fleece'] },
  { label: 'Trousers / Jeans', category: 'TEXTILES', powerType: 'NOT_APPLICABLE', keywords: ['trousers', 'jeans', 'chinos', 'leggings', 'shorts', 'denim'] },
  { label: 'Jumper / Sweater', category: 'TEXTILES', powerType: 'NOT_APPLICABLE', keywords: ['jumper', 'sweater', 'cardigan', 'knitwear', 'pullover', 'hoodie', 'sweatshirt'] },
  { label: 'Dress / Skirt', category: 'TEXTILES', powerType: 'NOT_APPLICABLE', keywords: ['dress', 'skirt', 'gown', 'blouse'] },
  { label: 'Shirt / Top', category: 'TEXTILES', powerType: 'NOT_APPLICABLE', keywords: ['shirt', 't-shirt', 'polo shirt'] },
  { label: 'Backpack / Rucksack', category: 'TEXTILES', powerType: 'NOT_APPLICABLE', keywords: ['backpack', 'rucksack', 'school bag', 'satchel'] },
  { label: 'Handbag / Bag', category: 'TEXTILES', powerType: 'NOT_APPLICABLE', keywords: ['handbag', 'bag', 'tote bag', 'purse', 'shoulder bag'] },
  { label: 'Cushion / Curtain', category: 'TEXTILES', powerType: 'NOT_APPLICABLE', keywords: ['cushion', 'curtain', 'pillowcase', 'throw', 'blanket', 'duvet cover'] },

  // Woodwork & Furniture
  { label: 'Chair / Stool', category: 'WOODWORK', powerType: 'NOT_APPLICABLE', keywords: ['chair', 'stool', 'dining chair', 'folding chair', 'armchair', 'footstool'] },
  { label: 'Small Table', category: 'WOODWORK', powerType: 'NOT_APPLICABLE', keywords: ['table', 'side table', 'coffee table', 'nest of tables'] },
  { label: 'Wooden Box / Drawer', category: 'WOODWORK', powerType: 'NOT_APPLICABLE', keywords: ['wooden box', 'drawer', 'jewellery box', 'cabinet', 'shelf'] },
  { label: 'Picture Frame', category: 'WOODWORK', powerType: 'NOT_APPLICABLE', keywords: ['photo frame', 'mirror frame'] },

  // Toys & Games
  { label: 'Electronic Toy', category: 'TOY', powerType: 'BATTERY_LOW_VOLTAGE', keywords: ['remote control car', 'rc car', 'talking toy', 'musical toy'] },
  { label: 'Soft Toy / Teddy Bear', category: 'TOY', powerType: 'NOT_APPLICABLE', keywords: ['soft toy', 'teddy bear', 'plush toy', 'cuddly toy'] },
  { label: 'Doll / Action Figure', category: 'TOY', powerType: 'NOT_APPLICABLE', keywords: ['doll', 'action figure'] },
  { label: 'Wooden Toy / Board Game', category: 'TOY', powerType: 'NOT_APPLICABLE', keywords: ['wooden toy', 'board game', 'puzzle', 'train set'] },

  // Other / Miscellaneous
  { label: 'Ceramic / Ornament', category: 'OTHER', powerType: 'NOT_APPLICABLE', keywords: ['ceramic', 'ornament', 'pottery', 'vase', 'mug', 'plate', 'china'] },
  { label: 'Jewellery', category: 'OTHER', powerType: 'NOT_APPLICABLE', keywords: ['necklace', 'bracelet', 'earring', 'ring', 'brooch'] },
];
