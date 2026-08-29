import { Icon } from "@/components/Icon";
type Name=Parameters<typeof Icon>[0]["name"];
export function CompactMetric({icon,tone,label,value}:{icon:Name;tone:string;label:string;value:string}){
  return <article className="compact-stat"><span className={`compact-stat-icon ${tone}`}><Icon name={icon} size={17}/></span><div><span>{label}</span><strong>{value}</strong></div></article>;
}
