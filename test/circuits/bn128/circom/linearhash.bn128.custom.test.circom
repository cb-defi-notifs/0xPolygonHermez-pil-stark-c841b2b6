pragma circom 2.1.0;
pragma custom_templates;

include "../../../../circuits.bn128.custom/linearhash.circom";

component main = LinearHash(9, 3, 16);