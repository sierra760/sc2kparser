(function() {
"use strict"

let sc2kparser = {};
let buildingNames = require('./buildingNames.json');

// RLE decompression
sc2kparser.decompressSegment = function(bytes) {
  let output = [];
  let dataCount = 0;

  for(let i=0; i<bytes.length; i++) {
    if(dataCount > 0) {
      output.push(bytes[i]);
      dataCount -= 1;
      continue;
    }

    if(bytes[i] < 128) {
      // data bytes
      dataCount = bytes[i];
    } else {
      // run-length encoded byte
      let repeatCount = bytes[i] - 127;
      let repeated = bytes[i+1];
      for(let j=0; j<repeatCount; j++) {
        output.push(repeated);
      }
      // skip the next byte
      i += 1;
    }
  }

  return Uint8Array.from(output);
};

let alreadyDecompressedSegments = {
  'ALTM': true,
  'CNAM': true
};

// split segments into a hash indexed by segment title
sc2kparser.splitIntoSegments = function(rest) {
  let segments = {};
  while(rest.length > 0) {
    let segmentTitle = Array.prototype.map.call(rest.subarray(0, 4), x => String.fromCharCode(x)).join('');
    let lengthBytes = rest.subarray(4, 8);
    let segmentLength = new DataView(lengthBytes.buffer).getUint32(lengthBytes.byteOffset);
    let segmentContent = rest.subarray(8, 8+segmentLength);
    if(!alreadyDecompressedSegments[segmentTitle]) {
      segmentContent = sc2kparser.decompressSegment(segmentContent);
    }
    segments[segmentTitle] = segmentContent;
    rest = rest.subarray(8+segmentLength);
  }
  return segments;
};

// slopes define the relative heights of corners
let xterSlopeMap = {
  0x0: [0,0,0,0],
  0x1: [1,1,0,0],
  0x2: [0,1,0,1],
  0x3: [0,0,1,1],
  0x4: [1,0,1,0],
  0x5: [1,1,0,1],
  0x6: [0,1,1,1],
  0x7: [1,0,1,1],
  0x8: [1,1,1,0],
  0x9: [0,1,0,0],
  0xA: [0,0,0,1],
  0xB: [0,0,1,0],
  0xC: [1,0,0,0],
  0xD: [1,1,1,1]
};

// denotes which sides have land
let xterWaterMap = {
  0x0: [1,0,0,1], // left-right open canal
  0x1: [0,1,1,0], // top-bottom open canal
  0x2: [1,1,0,1], // right open bay
  0x3: [1,0,1,1], // left open bay
  0x4: [0,1,1,1], // top open bay
  0x5: [1,1,1,0]  // bottom open bay
};

let waterLevels = {
  0x0: "dry",
  0x1: "submerged",
  0x2: "shore",
  0x3: "surface",
  0x4: "waterfall"
};

// Zone types from SC2 spec
let zoneTypes = {
  0: "none",
  1: "light_residential",
  2: "dense_residential", 
  3: "light_commercial",
  4: "dense_commercial",
  5: "light_industrial",
  6: "dense_industrial",
  7: "military",
  8: "airport",
  9: "seaport"
};

sc2kparser.segmentHandlers = {
  'ALTM': (data, struct) => {
    // ALTM is stored as 16-bit integers
    // NOTE: This appears to be a Mac/DOS file, so using that format
    let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for(let i=0; i<data.byteLength/2; i++) {
      let square = view.getUint16(i*2);
      
      // Mac/DOS format (from simcity-2000-info.txt):
      // Bits 0-4: altitude (0-31, multiply by 100 and add 50 for feet)
      // Bit 7: water flag
      let altitude = ((square & 0x001F) * 100) + 50;
      let water = (square & 0x0080) !== 0;
      
      struct.tiles[i].alt = altitude;
      struct.tiles[i].water = water;
      
      // Windows 95 format would be:
      // Bits 0-5: tunnel level
      // Bits 6-10: water level (5 bits)
      // Bits 11-15: land altitude (5 bits)
      // If we need to support Windows 95 format later:
      // let tunnelLevel = square & 0x003F;
      // let waterLevel = (square >> 5) & 0x001F;
      // let altitude = (square >> 10) & 0x001F;
    }
  },
  'CNAM': (data, struct) => {
    let view = new Uint8Array(data);
    let len = view[0]; // First byte is length
    if (len > 31) len = 31; // Max 31 chars
    let strDat = view.subarray(1, 1+len);
    struct.cityName = Array.prototype.map.call(strDat, x => String.fromCharCode(x)).join('');
  },
  'XBIT': (data, struct) => {
    let view = new Uint8Array(data);
    view.forEach((square, i) => {
      let tile = struct.tiles[i];
      // Bit 0: Powerable
      tile.powerable = (square & 0x01) !== 0;
      // Bit 1: Powered 
      tile.powered = (square & 0x02) !== 0;
      // Bit 2: Piped
      tile.piped = (square & 0x04) !== 0;
      // Bit 3: Watered
      tile.watered = (square & 0x08) !== 0;
      // Bit 4: XVAL mask
      tile.xvalMask = (square & 0x10) !== 0;
      // Bit 5: Water covered
      tile.waterCovered = (square & 0x20) !== 0;
      // Bit 6: Rotate 90 degrees
      tile.rotate = (square & 0x40) !== 0;
      // Bit 7: Salt water
      tile.saltWater = (square & 0x80) !== 0;
      
      // Keep old names for compatibility
      tile.conductive = tile.powerable;
      tile.powersupplied = tile.powered;
      tile.watersupplied = tile.watered;
      tile.watercover = tile.waterCovered;
      tile.saltwater = tile.saltWater;
    });
  },
  'XBLD': (data, struct) => {
    let view = new Uint8Array(data);
    view.forEach((square, i) => {
      struct.tiles[i].building = square;
      // Convert to hex and lookup building name
      let hexCode = square.toString(16).toUpperCase().padStart(2, '0');
      struct.tiles[i].buildingName = buildingNames[hexCode] || buildingNames[square.toString()];
      // Building type and size will be set after all segments are processed
    });
  },
  'XTER': (data, struct) => {
    let view = new Uint8Array(data);
    view.forEach((square, i) => {
      let terrain = {};
      if(square < 0x3E) {
        let slope = square & 0x0F;
        let wetness = (square & 0xF0) >> 4;
        terrain.slope = xterSlopeMap[slope];
        terrain.waterlevel = waterLevels[wetness];
      } else if(square === 0x3E) {
        terrain.slope = xterSlopeMap[0];
        terrain.waterlevel = waterLevels[0x4];
      } else if(square >= 0x40 && square <= 0x45) {
        let surfaceWater = square - 0x40;
        terrain.slope = xterSlopeMap[0];
        terrain.surfaceWater = xterWaterMap[surfaceWater];
        terrain.waterlevel = waterLevels[0x3];
      }
      struct.tiles[i].terrain = terrain;
    });
  },
  'XUND': (data, struct) => {
    let view = new Uint8Array(data);
    view.forEach((square, i) => {
      let underground = {};
      underground.slope = xterSlopeMap[0x0]; // default flat
      
      if(square >= 0x01 && square <= 0x0F) {
        // Subway
        underground.subway = true;
        underground.slope = xterSlopeMap[square];
      } else if(square >= 0x10 && square <= 0x1E) {
        // Pipes
        underground.pipes = true;
        underground.slope = xterSlopeMap[square - 0x10];
      } else if(square === 0x1F) {
        // Crossover: pipe TB, subway LR
        underground.subway = true;
        underground.pipes = true;
        underground.subwayLeftRight = true;
      } else if(square === 0x20) {
        // Crossover: pipe LR, subway TB
        underground.subway = true;
        underground.pipes = true;
        underground.subwayLeftRight = false;
      } else if(square === 0x22) {
        // Missile silo
        underground.missileSilo = true;
      } else if(square === 0x23) {
        // Subway station
        underground.subwayStation = true;
      }
      
      struct.tiles[i].underground = underground;
    });
  },
  'XZON': (data, struct) => {
    let view = new Uint8Array(data);
    view.forEach((square, i) => {
      let zone = {};
      // NOTE: This file appears to be in Mac/DOS format, not Windows 95 format
      // Mac/DOS format (from simcity-2000-info.txt):
      //   Bits 7-4: corner bits (TL=0x80, LL=0x40, LR=0x20, UR=0x10)
      //   Bits 3-0: zone type
      // Windows 95 format (from sc2 file spec.md):
      //   Bits 3-0: corner bits (BL=0x01, BR=0x02, TR=0x04, TL=0x08)
      //   Bits 7-4: zone type
      
      // Using Mac/DOS format since this appears to be a Mac save file
      zone.topLeft = (square & 0x80) !== 0;     // Bit 7
      zone.bottomLeft = (square & 0x40) !== 0;  // Bit 6
      zone.bottomRight = (square & 0x20) !== 0; // Bit 5
      zone.topRight = (square & 0x10) !== 0;    // Bit 4
      
      // Zone type in lower 4 bits for Mac/DOS format
      zone.type = square & 0x0F;
      zone.typeName = zoneTypes[zone.type] || "unknown";
      
      struct.tiles[i].zone = zone;
    });
  },
  'XTXT': (data, struct) => {
    let view = new Uint8Array(data);
    view.forEach((square, i) => {
      if(square !== 0) {
        struct.tiles[i].text = square;
        // Decode what the text means
        if(square <= 0x32) {
          struct.tiles[i].textType = 'sign';
          struct.tiles[i].signIndex = square;
        } else if(square >= 0x34 && square <= 0xC8) {
          struct.tiles[i].textType = 'microsim';
          struct.tiles[i].microsimIndex = square - 0x34;
        } else if(square === 0xFA) {
          struct.tiles[i].textType = 'neighbor';
        } else if(square >= 0xFB) {
          struct.tiles[i].textType = 'disaster';
        }
      }
    });
  },
  'XLAB': (data, struct) => {
    // labels (1 byte len + 24 byte string)
    let view = new Uint8Array(data);
    let labels = [];
    for(let i=0; i<256; i++) {
      let labelPos = i*25;
      let labelLength = Math.max(0, Math.min(view[labelPos], 24));
      let labelData = view.subarray(labelPos+1, labelPos+1+labelLength);
      labels[i] = Array.prototype.map.call(labelData, x => String.fromCharCode(x)).join('');
    }
    struct.labels = labels;
  },
  'XMIC': (data, struct) => {
    // Microsimulators - 150 x 8 bytes
    let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let microsims = [];
    for(let i=0; i<150; i++) {
      let offset = i * 8;
      microsims.push({
        buildingType: view.getUint8(offset),
        value1: view.getUint8(offset + 1),
        value2: view.getUint16(offset + 2, true),
        value3: view.getUint16(offset + 4, true),
        value4: view.getUint16(offset + 6, true)
      });
    }
    struct.microsims = microsims;
  },
  'MISC': (data, struct) => {
    let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    
    // Basic city info
    struct.header = view.getUint32(0);
    struct.cityMode = view.getInt32(0x04);
    struct.rotation = view.getInt32(0x08);
    struct.founded = view.getInt32(0x0C);
    struct.cityAge = view.getInt32(0x10);
    struct.money = view.getInt32(0x14);
    struct.bonds = view.getInt32(0x18);
    struct.gameLevel = view.getInt32(0x1C);
    struct.cityStatus = view.getInt32(0x20);
    struct.cityValue = view.getInt32(0x24);
    struct.landValue = view.getInt32(0x28);
    struct.crimeCount = view.getInt32(0x2C);
    struct.trafficCount = view.getInt32(0x30);
    struct.pollution = view.getInt32(0x34);
    struct.cityFame = view.getInt32(0x38);
    struct.advertising = view.getInt32(0x3C);
    struct.garbage = view.getInt32(0x40);
    struct.workForcePercent = view.getInt32(0x44);
    struct.workForceLE = view.getInt32(0x48);
    struct.workForceEQ = view.getInt32(0x4C);
    struct.nationalPopulation = view.getInt32(0x50);
    struct.nationalValue = view.getInt32(0x54);
    struct.nationalTax = view.getInt32(0x58);
    struct.nationalTrend = view.getInt32(0x5C);
    struct.heat = view.getInt32(0x60);
    struct.wind = view.getInt32(0x64);
    struct.humidity = view.getInt32(0x68);
    struct.weatherTrend = view.getInt32(0x6C);
    struct.disasters = view.getInt32(0x70);
    struct.residentialPopulation = view.getInt32(0x74);
    
    // Building counts at offset 0x1F0 (496)
    struct.buildingCounts = [];
    for(let i = 0; i < 256; i++) {
      struct.buildingCounts[i] = view.getInt32(0x1F0 + i * 4);
    }
    
    // Various other fields
    struct.populatedTiles = view.getInt32(0x5F0);
    struct.residentialTiles = view.getInt32(0x5F8);
    struct.commercialTiles = view.getInt32(0x600);
    struct.industrialTiles = view.getInt32(0x608);
    
    // RCI demand at 0x718
    struct.residentialDemand = view.getInt32(0x718);
    struct.commercialDemand = view.getInt32(0x71C);
    struct.industrialDemand = view.getInt32(0x720);
    
    // Settings
    struct.speed = view.getInt32(0xFEC);
    struct.autoBudget = view.getInt32(0xFF0);
    struct.autoGoto = view.getInt32(0xFF4);
    struct.sound = view.getInt32(0xFF8);
    struct.music = view.getInt32(0xFFC);
    struct.noDisasters = view.getInt32(0x1000);
    
    // View position
    struct.viewX = view.getInt32(0x1018);
    struct.viewY = view.getInt32(0x101C);
    
    // Water level (sea level) at 0xE40
    struct.waterLevel = view.getInt32(0xE40);
    struct.terrainCoast = view.getInt32(0xE44);
    struct.terrainRiver = view.getInt32(0xE48);
    
    // Population
    struct.arcoPopulation = view.getInt32(0x1020);
    struct.normalPopulation = view.getInt32(0x102C);
    struct.population = struct.normalPopulation + struct.arcoPopulation;
    
    // Keep old names for compatibility
    struct.first = struct.header;
    struct.daysElapsed = struct.cityAge;
  },
  // Minimap data - 64x64
  'XTRF': (data, struct) => {
    struct.traffic = Array.from(new Uint8Array(data));
  },
  'XPLT': (data, struct) => {
    struct.pollution = Array.from(new Uint8Array(data));
  },
  'XVAL': (data, struct) => {
    struct.landValues = Array.from(new Uint8Array(data));
  },
  'XCRM': (data, struct) => {
    struct.crime = Array.from(new Uint8Array(data));
  },
  // Minimap data - 32x32
  'XPLC': (data, struct) => {
    struct.policeCoverage = Array.from(new Uint8Array(data));
  },
  'XFIR': (data, struct) => {
    struct.fireCoverage = Array.from(new Uint8Array(data));
  },
  'XPOP': (data, struct) => {
    struct.populationDensity = Array.from(new Uint8Array(data));
  },
  'XROG': (data, struct) => {
    struct.rateOfGrowth = Array.from(new Uint8Array(data));
  },
  'XGRP': (data, struct) => {
    // Graph data - 16 graphs with historical data
    struct.graphs = data;
  },
  'XTHG': (data, struct) => {
    // Things (airplanes, boats, etc) - needs more research
    struct.things = data;
  }
};

// Building type detection helpers
sc2kparser.getBuildingType = function(buildingCode) {
  if (!buildingCode || buildingCode === 0) return null;
  
  // Infrastructure
  if (buildingCode >= 0x06 && buildingCode <= 0x0C) return 'tree';
  if (buildingCode >= 0x0E && buildingCode <= 0x1C) return 'powerline';
  if (buildingCode >= 0x1D && buildingCode <= 0x2B) return 'road';
  if (buildingCode >= 0x2C && buildingCode <= 0x3E) return 'rail';
  if (buildingCode >= 0x3F && buildingCode <= 0x40) return 'tunnel';
  if (buildingCode >= 0x41 && buildingCode <= 0x48) return 'crossover';
  if (buildingCode >= 0x49 && buildingCode <= 0x69) return 'highway';
  
  // Buildings
  if (buildingCode >= 0x70 && buildingCode <= 0x7B) return 'residential_1x1';
  if (buildingCode >= 0x7C && buildingCode <= 0x83) return 'commercial_1x1';
  if (buildingCode >= 0x84 && buildingCode <= 0x87) return 'industrial_1x1';
  if (buildingCode >= 0x8C && buildingCode <= 0x93) return 'residential_2x2';
  if (buildingCode >= 0x94 && buildingCode <= 0x9D) return 'commercial_2x2';
  if (buildingCode >= 0x9E && buildingCode <= 0xA5) return 'industrial_2x2';
  if (buildingCode >= 0xAE && buildingCode <= 0xB1) return 'residential_3x3';
  if (buildingCode >= 0xB2 && buildingCode <= 0xBB) return 'commercial_3x3';
  if (buildingCode >= 0xBC && buildingCode <= 0xC1) return 'industrial_3x3';
  if (buildingCode >= 0xC9 && buildingCode <= 0xCF) return 'powerplant_4x4';
  if (buildingCode >= 0xD0 && buildingCode <= 0xDA) return 'civic';
  if (buildingCode >= 0xFB && buildingCode <= 0xFE) return 'arcology_4x4';
  
  return 'other';
};

sc2kparser.getBuildingSize = function(buildingCode) {
  const type = sc2kparser.getBuildingType(buildingCode);
  if (!type) return 0;
  
  if (type.endsWith('_1x1')) return 1;
  if (type.endsWith('_2x2')) return 2;
  if (type.endsWith('_3x3')) return 3;
  if (type.endsWith('_4x4')) return 4;
  
  // Most civic buildings are 3x3, except stadium, prison, college, zoo (4x4)
  if (type === 'civic') {
    if (buildingCode >= 0xD7 && buildingCode <= 0xDA) return 4;
    return 3;
  }
  
  return 1; // Default for infrastructure and unknown
};

// Find multi-tile buildings by looking for square patterns of the same building code
sc2kparser.findMultiTileBuildings = function(tiles) {
  const buildings = [];
  const processed = new Set();
  
  // Check each possible multi-tile building size
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const i = y * 128 + x;
      if (processed.has(i)) continue;
      
      const tile = tiles[i];
      if (!tile.building || tile.building === 0) continue;
      
      // Skip small buildings and infrastructure
      if (tile.building < 0x70) continue;
      
      // Check for largest possible building first (4x4), then smaller
      let found = false;
      for (let size = 4; size >= 2; size--) {
        if (x + size > 128 || y + size > 128) continue;
        
        // Check if all tiles in this square have the same building code
        let allMatch = true;
        for (let dy = 0; dy < size && allMatch; dy++) {
          for (let dx = 0; dx < size && allMatch; dx++) {
            const checkTile = tiles[(y + dy) * 128 + x + dx];
            if (!checkTile || checkTile.building !== tile.building) {
              allMatch = false;
            }
          }
        }
        
        if (allMatch) {
          // Found a multi-tile building
          buildings.push({
            x: x,
            y: y,
            width: size,
            height: size,
            building: tile.building,
            buildingName: tile.buildingName
          });
          
          // Mark all tiles as processed
          for (let dy = 0; dy < size; dy++) {
            for (let dx = 0; dx < size; dx++) {
              const tileIndex = (y + dy) * 128 + x + dx;
              processed.add(tileIndex);
              // Also mark the tile as part of this building
              tiles[tileIndex].multiTileBuilding = {
                topLeftX: x,
                topLeftY: y,
                width: size,
                height: size
              };
            }
          }
          found = true;
          break;
        }
      }
      
      // Mark 1x1 buildings as processed too
      if (!found) {
        processed.add(i);
      }
    }
  }
  
  return buildings;
};

// decompress and interpret bytes into a combined tiles format
sc2kparser.toVerboseFormat = function(segments) {
  let struct = {};
  struct.tiles = [];
  for(let i=0; i<128*128; i++) {
    struct.tiles.push({});
  }

  Object.keys(segments).forEach((segmentTitle) => {
    let data = segments[segmentTitle];
    let handler = sc2kparser.segmentHandlers[segmentTitle];
    if(handler) {
      handler(data, struct);
    }
  });
  
  // Add building type and size information to each tile
  struct.tiles.forEach(tile => {
    if (tile.building) {
      tile.buildingType = sc2kparser.getBuildingType(tile.building);
      tile.buildingSize = sc2kparser.getBuildingSize(tile.building);
    }
  });
  
  // Find multi-tile buildings
  struct.multiTileBuildings = sc2kparser.findMultiTileBuildings(struct.tiles);
  
  return struct;
};

// bytes -> file segments decompressed
sc2kparser.parse = function(bytes, options) {
  let buffer = new Uint8Array(bytes);
  let fileHeader = buffer.subarray(0, 12);
  let rest = buffer.subarray(12);
  let segments = sc2kparser.splitIntoSegments(rest);
  let struct = sc2kparser.toVerboseFormat(segments);
  return struct;
};

// check header bytes
sc2kparser.isSimCity2000SaveFile = function(bytes) {
  // check IFF header
  if(bytes[0] !== 0x46 ||
     bytes[1] !== 0x4F ||
     bytes[2] !== 0x52 ||
     bytes[3] !== 0x4D) {
    return false;
  }

  // check sc2k header
  if(bytes[8] !== 0x53 ||
     bytes[9] !== 0x43 ||
     bytes[10] !== 0x44 ||
     bytes[11] !== 0x48) {
    return false;
  }

  return true;
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = sc2kparser;
} else {
  window.sc2kparser = sc2kparser;
}

})();