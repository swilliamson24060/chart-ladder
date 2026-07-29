// The dataset JSON files are several MB of generated data - let TypeScript
// treat them as `any` instead of inferring a giant literal type for every
// row, which would make the type checker crawl.
declare module "*/data/songs.json" {
  const value: any;
  export default value;
}
declare module "*/data/artists.json" {
  const value: any;
  export default value;
}
declare module "*/data/connections.json" {
  const value: any;
  export default value;
}
